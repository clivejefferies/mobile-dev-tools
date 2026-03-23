import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { AndroidObserve } from '../../../src/observe/index.js'

async function run() {
  const tmp = os.tmpdir()
  const sessionId = 'unit-test-logstream'
  const file = path.join(tmp, `mobile-debug-log-${sessionId}.ndjson`)

  // Prepare NDJSON with one crash entry and one info entry
  const crashEntry = { timestamp: '2026-03-13T14:00:00.000Z', level: 'E', tag: 'AndroidRuntime', message: 'FATAL EXCEPTION: main\njava.lang.NullPointerException' }
  const infoEntry = { timestamp: '2026-03-13T14:01:00.000Z', level: 'I', tag: 'MyTag', message: 'Info message' }

  await fs.writeFile(file, JSON.stringify(crashEntry) + '\n' + JSON.stringify(infoEntry) + '\n')


  try {
    // Read all via AndroidObserve (falls back to session NDJSON file)
    const obs = new AndroidObserve()
    const { entries, crash_summary } = await obs.readLogStream(sessionId, 10)
    if (!Array.isArray(entries) || entries.length !== 2) throw new Error('Expected 2 entries')
    if (!crash_summary || crash_summary.crash_detected !== true) throw new Error('Expected crash_detected true')
    if (!crash_summary.exception || !/NullPointerException/.test(crash_summary.exception)) throw new Error('Expected NullPointerException detected')

    console.log('Test 1 PASS: basic parsing & crash detection')

    // Test since filter (after first entry)
    const since = new Date('2026-03-13T14:00:30.000Z').toISOString()
    const r2 = await obs.readLogStream(sessionId, 10, since)
    if (r2.entries.length !== 1) throw new Error('Expected 1 entry after since filter')
    console.log('Test 2 PASS: since filter')

    // Test limit
    const r3 = await obs.readLogStream(sessionId, 1)
    if (r3.entries.length !== 1) throw new Error('Expected 1 entry with limit=1')
    console.log('Test 3 PASS: limit works')

    console.log('ALL logstream tests passed')
  } finally {
    await fs.unlink(file).catch(()=>{})
  }
}

run().catch(err => { console.error('Logstream tests failed:', err); process.exit(1) })