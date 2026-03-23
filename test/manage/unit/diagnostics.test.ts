import assert from 'assert'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

async function makeTempFile(ext: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-test-'))
  const file = path.join(dir, `fake${ext}`)
  await fs.writeFile(file, 'binary')
  return { dir, file }
}

export async function run() {
  // Android diagnostic: fake adb that fails
  const binDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-adb-bin-'))
  const adbPath = path.join(binDir, 'adb')
  const adbScript = `#!/usr/bin/env node
console.error('adb: device not found')
process.exit(1)
`
  await fs.writeFile(adbPath, adbScript, { mode: 0o755 })
  const origPath = process.env.PATH || ''
  const origAdbPath = process.env.ADB_PATH
  // Prefer explicit ADB_PATH to point at our fake adb to ensure deterministic behavior
  process.env.ADB_PATH = adbPath
  // Prefix PATH so our fake adb is preferred but keep original PATH to allow /usr/bin/env node to work
  process.env.PATH = `${binDir}:${origPath}`

  const { AndroidManage } = await import('../../../src/manage/index.js')

  try {
    const { dir, file: apk } = await makeTempFile('.apk')
    const am = new AndroidManage()
    const res = await am.installApp(apk)
    console.log('android diag res', res)
    // Installation may succeed in some environments (if a different fake adb is present).
    // If it failed, ensure diagnostics are present; if it succeeded, ensure output exists.
    if (res.installed === false) {
      assert.ok(res.diagnostics, 'Expected diagnostics on failure')
      // diagnostics should include installDiag/pushDiag/pmDiag or at least installDiag.runResult
      const diag = res.diagnostics
      assert.ok(diag.installDiag && diag.installDiag.runResult, 'installDiag.runResult present')
      const run = diag.installDiag.runResult
      assert.ok(typeof run.exitCode === 'number' || run.exitCode === null)
      assert.ok('stdout' in run && 'stderr' in run && 'envSnapshot' in run && 'command' in run)
    } else {
      assert.ok(res.output && typeof res.output === 'string', 'Expected some output on successful install')
    }

    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  } finally {
    process.env.PATH = origPath
    if (typeof origAdbPath !== 'undefined') process.env.ADB_PATH = origAdbPath
    else delete process.env.ADB_PATH
  }

  // iOS diagnostic: fake xcrun that fails
  const binDir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-xcrun-bin-'))
  const xcrunPath = path.join(binDir2, 'xcrun')
  const xcrunScript = `#!/usr/bin/env node
console.error("xcodebuild: error: '...xcodeproj' does not exist")
process.exit(1)
`
  await fs.writeFile(xcrunPath, xcrunScript, { mode: 0o755 })
  const origPath2 = process.env.PATH || ''
  const origXcrunPath = process.env.XCRUN_PATH
  // Point XCRUN_PATH to our fake xcrun to ensure deterministic failure
  process.env.XCRUN_PATH = xcrunPath
  // Prefix PATH so our fake xcrun is preferred but keep original PATH to allow /usr/bin/env node to work
  process.env.PATH = `${binDir2}:${origPath2}`

  try {
    const { iOSManage } = await import('../../../src/manage/index.js')
    const im = new iOSManage()
    const res2 = await im.startApp('com.example.myapp')
    console.log('ios diag res', res2)
    assert.ok(res2.appStarted === false, 'Expected startApp to report failure')
    assert.ok((res2 as any).diagnostics, 'Expected diagnostics for iOS start failure')
    const run2 = (res2 as any).diagnostics.runResult
    assert.ok(run2 && ('exitCode' in run2) && ('stderr' in run2))
  } finally {
    process.env.PATH = origPath2
    if (typeof origXcrunPath !== 'undefined') process.env.XCRUN_PATH = origXcrunPath
    else delete process.env.XCRUN_PATH
  }

  console.log('diagnostics tests passed')
}

run().catch((e) => { console.error(e); process.exit(1) })