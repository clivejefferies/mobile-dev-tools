import { AndroidObserve } from '../../src/android/observe.js'

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  const packageName = process.argv[2] || 'com.android.systemui'
  const sessionId = 'real-logstream'
  console.log('Starting log stream for', packageName)
  const obs = new AndroidObserve()
  const start = await obs.startLogStream(packageName, 'error', undefined, sessionId)
  console.log('start result:', start)
  if (!start.success) {
    console.error('Failed to start log stream:', start.error)
    process.exit(start.error === 'app_not_running' ? 2 : 1)
  }

  try {
    for (let i=0;i<10;i++) {
      console.log('\nPolling logs (iteration', i+1, ')')
      const { entries, crash_summary } = await obs.readLogStream(sessionId, 50)
      console.log(`Entries: ${entries.length}`)
      if (entries.length > 0) console.log('Latest:', entries[entries.length-1])
      console.log('Crash summary:', crash_summary)
      if (crash_summary && crash_summary.crash_detected) {
        console.log('Crash detected; stopping early')
        break
      }
      await sleep(1000)
    }
  } finally {
    console.log('Stopping log stream')
    await obs.stopLogStream(sessionId)
  }
}

main().catch(err => { console.error(err); process.exit(1) })
