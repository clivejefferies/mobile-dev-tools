import assert from 'assert'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'

async function makeAndroidProject() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-build-ai-android-'))
  const gradlew = path.join(dir, 'gradlew')
  const script = `#!/bin/sh
mkdir -p "$(pwd)/app/build/outputs/apk/debug"
echo 'fake-apk' > "$(pwd)/app/build/outputs/apk/debug/app-debug.apk"
echo 'BUILD SUCCESS'
exit 0
`
  await fs.writeFile(gradlew, script, { mode: 0o755 })
  return dir
}

async function makeIOSProject() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-build-ai-ios-'))
  const ws = path.join(dir, 'Example.xcworkspace')
  await fs.writeFile(ws, '')
  return dir
}

export async function run() {
  const androidProject = await makeAndroidProject()
  const iosProject = await makeIOSProject()

  // Create fake bin dir with adb and simctl
  const binDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-bin-'))
  const adbPath = path.join(binDir, 'adb')
  const adbScript = `#!/usr/bin/env node
const args = process.argv.slice(2)
if (args.includes('devices')) {
  console.log('List of devices attached')
  console.log('emulator-5554\tdevice product:sdk_gphone64_arm64')
  process.exit(0)
}
if (args.includes('install')) {
  console.log('Performing Streamed Install')
  console.log('Success')
  process.exit(0)
}
if (args.includes('shell')) {
  const idx = args.indexOf('shell')
  const shellArgs = args.slice(idx+1)
  if (shellArgs[0] === 'getprop') {
    console.log('')
    process.exit(0)
  }
  console.log('Success')
  process.exit(0)
}
console.log('OK')
process.exit(0)
`
  await fs.writeFile(adbPath, adbScript, { mode: 0o755 })

  const simctlPath = path.join(binDir, 'simctl')
  const simctlScript = `#!/usr/bin/env node
const args = process.argv.slice(2)
if (args.includes('install')) {
  console.log('simctl install simulated')
  process.exit(0)
}
// Respond to 'list devices --json'
if (args.includes('list') && args.includes('devices') && args.includes('--json')) {
  const out = { devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-17-0': [ { udid: 'booted', name: 'iPhone 14', state: 'Booted' } ] } }
  console.log(JSON.stringify(out))
  process.exit(0)
}
console.log('simctl ok')
process.exit(0)
`
  await fs.writeFile(simctlPath, simctlScript, { mode: 0o755 })

  // fake xcodebuild for iOS build step
  const xcodeScript = `#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const app = path.join(process.cwd(),'Build','Products','Debug-iphonesimulator','Example.app')
fs.mkdirSync(app, { recursive: true })
fs.writeFileSync(path.join(app,'Info.plist'), '<plist/>')
console.log('xcodebuild simulated')
process.exit(0)
`
  const xcodePath = path.join(binDir, 'xcodebuild')
  await fs.writeFile(xcodePath, xcodeScript, { mode: 0o755 })

  const origPath = process.env.PATH || ''
  const origXcrun = process.env.XCRUN_PATH
  process.env.PATH = `${binDir}:${origPath}`
  process.env.XCRUN_PATH = simctlPath

  const { ToolsManage } = await import('../../../src/manage/index.js')

  try {
    // Android build_and_install
    const ares = await ToolsManage.buildAndInstallHandler({ platform: 'android', projectPath: androidProject, deviceId: 'emulator-5554' })
    console.log('android ndjson:\n', ares.ndjson)
    console.log('android result:', ares.result)
    if (ares.result.success !== true) {
      assert.ok(ares.result.error || ares.result.diagnostics, 'If build_and_install fails, expect error or diagnostics')
    } else {
      assert.ok(ares.result.artifactPath && ares.result.artifactPath.endsWith('.apk'))
      assert.ok(ares.ndjson.includes('"type":"build"'))
      assert.ok(ares.ndjson.includes('"type":"install"'))
    }

    // iOS build_and_install
    const ires = await ToolsManage.buildAndInstallHandler({ platform: 'ios', projectPath: iosProject, deviceId: 'booted' })
    console.log('ios ndjson:\n', ires.ndjson)
    console.log('ios result:', ires.result)
    if (ires.result.success !== true) {
      assert.ok(ires.result.error || ires.result.diagnostics, 'If build_and_install fails for iOS, expect error or diagnostics')
    } else {
      assert.ok(ires.result.artifactPath && ires.result.artifactPath.endsWith('.app'))
      assert.ok(ires.ndjson.includes('"type":"build"'))
      assert.ok(ires.ndjson.includes('"type":"install"'))
    }

    console.log('build_and_install tests passed')
  } finally {
    process.env.PATH = origPath
    if (origXcrun === undefined) delete process.env.XCRUN_PATH
    else process.env.XCRUN_PATH = origXcrun
    await fs.rm(androidProject, { recursive: true, force: true }).catch(() => {})
    await fs.rm(iosProject, { recursive: true, force: true }).catch(() => {})
    await fs.rm(binDir, { recursive: true, force: true }).catch(() => {})
  }
}

run().catch(e => { console.error(e); process.exit(1) })