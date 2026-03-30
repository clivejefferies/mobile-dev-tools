import { ToolsObserve } from '../../src/observe/index.js'
import minimist from 'minimist'

async function main() {
  const args = minimist(process.argv.slice(2))
  const platform = args.platform || args.p || 'android'
  const id = args.id || args.device || args.deviceId || 'default'
  const limit = typeof args.limit === 'number' ? args.limit : (typeof args.lines === 'number' ? args.lines : 50)

  try {
    const res = await ToolsObserve.getLogsHandler({ platform, id, limit })
    console.log(JSON.stringify(res))
    process.exit(0)
  } catch (err: any) {
    console.error(JSON.stringify({ error: { message: err.message || String(err) } }))
    process.exit(2)
  }
}

main()
