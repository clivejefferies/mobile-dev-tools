import { ToolsInteract } from '../../../src/interact/index.js'
import * as Observe from '../../../src/observe/index.js'

async function runTests() {
  console.log('Starting observe_until unit tests...')

  const origFind = (ToolsInteract as any).findElementHandler
  const origReadLog = (Observe as any).ToolsObserve.readLogStreamHandler
  const origGetLogs = (Observe as any).ToolsObserve.getLogsHandler
  const origGetFp = (Observe as any).ToolsObserve.getScreenFingerprintHandler
  const origResolveObserve = (Observe as any).ToolsObserve.resolveObserve
  const origGetScreenFp = (Observe as any).ToolsObserve.getScreenFingerprintHandler

  try {
    // Timeout / snapshot case: ensure snapshot captured when condition not met
    const origCapture = (Observe as any).ToolsObserve.captureDebugSnapshotHandler
    ;(Observe as any).ToolsObserve.captureDebugSnapshotHandler = async ({ reason }: any) => ({ reason, fingerprint: 'snap-123', ui_tree: null, logs: [] })
    // make findElement always fail
    (ToolsInteract as any).findElementHandler = async () => ({ found: false })
    const resTimeout = await ToolsInteract.observeUntilHandler({ type: 'ui', query: 'WillNeverExist', timeoutMs: 500, pollIntervalMs: 100, platform: 'android' })
    const okTimeout = resTimeout && !(resTimeout as any).success && (resTimeout as any).snapshot && (resTimeout as any).snapshot.fingerprint === 'snap-123' && (resTimeout as any).telemetry && (resTimeout as any).telemetry.pollCount > 0
    console.log('Timeout Snapshot Test:', okTimeout ? 'PASS' : 'FAIL', JSON.stringify((resTimeout as any).telemetry || {}, null, 2))
    ;(Observe as any).ToolsObserve.captureDebugSnapshotHandler = origCapture

    // UI condition: findElement returns found on 2nd call
    let calls = 0
    ;(ToolsInteract as any).findElementHandler = async (args) => {
      calls++
      const query = (args && (args.query || args)) || ''
      if (calls >= 2) return { found: true, element: { text: query } }
      return { found: false }
    }

    const resUi = await ToolsInteract.observeUntilHandler({ type: 'ui', query: 'Generate Session', timeoutMs: 3000, pollIntervalMs: 100, platform: 'android' })
    const okUi = resUi && (resUi as any).success && (resUi as any).telemetry && (resUi as any).telemetry.pollCount > 0 && (resUi as any).telemetry.timeToMatch >= 0
    console.log('UI Test:', okUi ? 'PASS' : 'FAIL', JSON.stringify((resUi as any).telemetry || {}, null, 2))

    // Log condition: stream empty, snapshot contains matching line
    ;(Observe as any).ToolsObserve.readLogStreamHandler = async () => ({ entries: [ { message: 'nothing' } ] })
    let glCalls = 0
    ;(Observe as any).ToolsObserve.getLogsHandler = async () => {
      glCalls++
      if (glCalls === 1) return { device: {}, logs: ['INFO start'] }
      return { device: {}, logs: ['INFO start', 'ERROR Exception occurred', 'Server: Boom'] }
    }

    const resLog = await ToolsInteract.observeUntilHandler({ type: 'log', query: 'Server', timeoutMs: 3000, pollIntervalMs: 100, platform: 'android' })
    const okLog = resLog && (resLog as any).success && (resLog as any).telemetry && (resLog as any).telemetry.pollCount > 0 && (resLog as any).telemetry.matchSource === 'log-snapshot'
    console.log('Log Test:', okLog ? 'PASS' : 'FAIL', JSON.stringify((resLog as any).telemetry || {}, null, 2))

    // Screen condition: fingerprint changes after a few polls
    let seq = ['A', 'A', 'B']
    ;(Observe as any).ToolsObserve.getScreenFingerprintHandler = async () => ({ fingerprint: seq.length ? seq.shift() : null })
    const resScreen = await ToolsInteract.observeUntilHandler({ type: 'screen', timeoutMs: 3000, pollIntervalMs: 100, platform: 'android' })
    const okScreen = resScreen && (resScreen as any).success && (resScreen as any).telemetry && (resScreen as any).telemetry.matchSource === 'screen-fingerprint'
    console.log('Screen Test:', okScreen ? 'PASS' : 'FAIL', JSON.stringify((resScreen as any).telemetry || {}, null, 2))

    // Idle condition: stable fingerprints observed
    let idleSeq = ['X', 'X', 'X']
    ;(Observe as any).ToolsObserve.getScreenFingerprintHandler = async () => ({ fingerprint: idleSeq.length ? idleSeq.shift() : 'X' })
    const resIdle = await ToolsInteract.observeUntilHandler({ type: 'idle', timeoutMs: 3000, pollIntervalMs: 100, platform: 'android' })
    const okIdle = resIdle && (resIdle as any).success && (resIdle as any).telemetry && (resIdle as any).telemetry.matchSource === 'idle-stable'
    console.log('Idle Test:', okIdle ? 'PASS' : 'FAIL', JSON.stringify((resIdle as any).telemetry || {}, null, 2))

  } finally {
    ;(ToolsInteract as any).findElementHandler = origFind
    ;(Observe as any).ToolsObserve.readLogStreamHandler = origReadLog
    ;(Observe as any).ToolsObserve.getLogsHandler = origGetLogs
    ;(Observe as any).ToolsObserve.getScreenFingerprintHandler = origGetFp
    ;(Observe as any).ToolsObserve.resolveObserve = origResolveObserve
    ;(Observe as any).ToolsObserve.getScreenFingerprintHandler = origGetScreenFp
    ;(Observe as any).ToolsObserve.getScreenFingerprintHandler = origGetScreenFp
  }
}

runTests().catch(console.error)
