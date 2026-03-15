import assert from 'assert'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'

// Test build_app handler by creating fake gradlew and xcodebuild behaviours

async function makeTempProject(platform: 'android' | 'ios') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `mcp-build-${platform}-`))
  if (platform === 'android') {
    const gradlew = path.join(dir, 'gradlew')
    const script = `#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const apk = path.join(process.cwd(),'app','build','outputs','apk','debug','app-debug.apk')
fs.mkdirSync(path.dirname(apk), { recursive: true })
fs.writeFileSync(apk, 'fake-apk')
console.log('BUILD SUCCESS')
process.exit(0)
`
    await fs.writeFile(gradlew, script, { mode: 0o755 })
  } else {
    // create minimal Xcode workspace structure
    const ws = path.join(dir, 'Example.xcworkspace')
    await fs.writeFile(ws, '')
    const script = `#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const app = path.join(process.cwd(),'Build','Products','Debug-iphonesimulator','Example.app')
fs.mkdirSync(app, { recursive: true })
fs.writeFileSync(path.join(app,'Info.plist'), '<plist/>')
console.log('BUILD SUCCESS')
process.exit(0)
`
    const xbuild = path.join(dir, 'xcodebuild')
    await fs.writeFile(xbuild, script, { mode: 0o755 })
  }
  return dir
}

export async function run() {
  const androidProject = await makeTempProject('android')
  const iosProject = await makeTempProject('ios')

  // Create a fake xcodebuild in PATH for the iOS build step
  const binDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-xcode-bin-'))
  const xcodeScript = `#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
// emulate xcodebuild by creating an Example.app inside Build/Products/Debug-iphonesimulator
const app = path.join(process.cwd(),'Build','Products','Debug-iphonesimulator','Example.app')
fs.mkdirSync(app, { recursive: true })
fs.writeFileSync(path.join(app,'Info.plist'), '<plist/>')
console.log('xcodebuild simulated')
process.exit(0)
`
  const xcodePath = path.join(binDir, 'xcodebuild')
  await fs.writeFile(xcodePath, xcodeScript, { mode: 0o755 })

  const origPath = process.env.PATH || ''
  process.env.PATH = `${binDir}:${origPath}`

  const { ToolsInteract } = await import('../../src/tools/interact.js')

  try {
    const ares = await ToolsInteract.buildAppHandler({ platform: 'android', projectPath: androidProject })
    console.log('android build', ares)
    assert.ok((ares as any).artifactPath && (ares as any).artifactPath.endsWith('.apk'))

    const ires = await ToolsInteract.buildAppHandler({ platform: 'ios', projectPath: iosProject })
    console.log('ios build', ires)
    assert.ok((ires as any).artifactPath && (ires as any).artifactPath.endsWith('.app'))

    console.log('build tests passed')
  } finally {
    // cleanup
    await fs.rm(androidProject, { recursive: true, force: true }).catch(() => {})
    await fs.rm(iosProject, { recursive: true, force: true }).catch(() => {})
    await fs.rm(binDir, { recursive: true, force: true }).catch(() => {})
    process.env.PATH = origPath
  }
}

run().catch(e => { console.error(e); process.exit(1) })