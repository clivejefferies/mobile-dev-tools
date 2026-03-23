import assert from 'assert'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'

export async function run() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-disable-'))
  try {
    // create ambiguous project (contains both iOS and Android markers)
    const both = path.join(dir, 'both')
    await fs.mkdir(both)
    await fs.writeFile(path.join(both, 'Example.xcodeproj'), '')
    await fs.writeFile(path.join(both, 'gradlew'), '')

    const orig = process.env.MCP_DISABLE_AUTODETECT
    process.env.MCP_DISABLE_AUTODETECT = '1'

    const { ToolsManage } = await import('../../../src/manage/index.js')

    try {
      // platform and projectType are now mandatory; calling without them should return a missing-params error
      const res = await ToolsManage.buildAndInstallHandler({ projectPath: both })
      console.log('result:', res.result)
      assert.strictEqual(res.result.success, false)
      assert.ok(String(res.result.error).includes('Both platform and projectType parameters are required'), 'Expected missing-params error')
      console.log('mcp_disable_autodetect test passed')
    } finally {
      if (orig === undefined) delete process.env.MCP_DISABLE_AUTODETECT
      else process.env.MCP_DISABLE_AUTODETECT = orig
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

run().catch(e => { console.error(e); process.exit(1) })