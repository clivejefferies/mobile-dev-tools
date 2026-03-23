import assert from 'assert'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { detectProjectPlatform } from '../../../src/manage/index.js'

export async function run() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-detect-'))
  try {
    // ios
    const iosDir = path.join(dir, 'iosproj')
    await fs.mkdir(iosDir)
    await fs.writeFile(path.join(iosDir, 'Example.xcodeproj'), '')
    const r1 = await detectProjectPlatform(iosDir)
    console.log('detect ios ->', r1)
    assert.strictEqual(r1, 'ios')

    // android
    const aDir = path.join(dir, 'androproj')
    await fs.mkdir(aDir)
    await fs.writeFile(path.join(aDir, 'gradlew'), '')
    const r2 = await detectProjectPlatform(aDir)
    console.log('detect android ->', r2)
    assert.strictEqual(r2, 'android')

    // ambiguous
    const bothDir = path.join(dir, 'both')
    await fs.mkdir(bothDir)
    await fs.writeFile(path.join(bothDir, 'Example.xcodeproj'), '')
    await fs.writeFile(path.join(bothDir, 'gradlew'), '')
    const r3 = await detectProjectPlatform(bothDir)
    console.log('detect both ->', r3)
    assert.strictEqual(r3, 'ambiguous')

    // file ext
    const file = path.join(dir, 'some.app')
    await fs.writeFile(file, '')
    const r4 = await detectProjectPlatform(file)
    console.log('detect file ->', r4)
    assert.strictEqual(r4, 'ios')

    console.log('detection tests passed')
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

run().catch(e => { console.error(e); process.exit(1) })