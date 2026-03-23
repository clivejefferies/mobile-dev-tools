import { ToolsObserve } from '../../../src/observe/index.js'

async function run() {
  console.log('Starting capture_debug_snapshot unit tests...')

  // Save original ToolsObserve handlers
  const origCaptureHandler = (ToolsObserve as any).captureScreenshotHandler
  const origGetCurrentHandler = (ToolsObserve as any).getCurrentScreenHandler
  const origGetFpHandler = (ToolsObserve as any).getScreenFingerprintHandler
  const origGetTreeHandler = (ToolsObserve as any).getUITreeHandler
  const origReadLogStreamHandler = (ToolsObserve as any).readLogStreamHandler
  const origGetLogsHandler = (ToolsObserve as any).getLogsHandler

  try {
    // --- Test 1: all components succeed and logs come from stream ---
    ;(ToolsObserve as any).captureScreenshotHandler = async function() {
      return { device: { platform: 'android', id: 'mock', osVersion: '12', model: 'Pixel', simulator: true }, screenshot: 'BASE64PNG', resolution: { width: 1080, height: 1920 } }
    }
    ;(ToolsObserve as any).getCurrentScreenHandler = async function() {
      return { device: { platform: 'android', id: 'mock' }, package: 'com.example', activity: 'com.example.Main', shortActivity: 'Main' }
    }
    ;(ToolsObserve as any).getScreenFingerprintHandler = async function() {
      return { fingerprint: 'abc123', activity: 'Main' }
    }
    ;(ToolsObserve as any).getUITreeHandler = async function() {
      return { device: { platform: 'android', id: 'mock', osVersion: '12', model: 'Pixel', simulator: true }, screen: '', resolution: { width: 1080, height: 1920 }, elements: [] }
    }
    ;(ToolsObserve as any).readLogStreamHandler = async function() {
      return { entries: [ { timestamp: '2026-03-23T20:00:00.000Z', level: 'ERROR', message: 'Boom' } ], crash_summary: { crash_detected: true } }
    }
    ;(ToolsObserve as any).getLogsHandler = async function() {
      return { device: { platform: 'android', id: 'mock' }, logs: [], logCount: 0 }
    }

    const res1: any = await ToolsObserve.captureDebugSnapshotHandler({ platform: 'android', includeLogs: true, logLines: 50, sessionId: 's1' })
    console.log('res1:', JSON.stringify(res1, null, 2))
    const pass1 = res1 && res1.screenshot === 'BASE64PNG' && res1.activity && res1.fingerprint === 'abc123' && Array.isArray(res1.logs) && res1.logs.length === 1
    console.log('Test 1:', pass1 ? 'PASS' : 'FAIL')

    // Restore handlers before next test
    ;(ToolsObserve as any).captureScreenshotHandler = origCaptureHandler
    ;(ToolsObserve as any).getCurrentScreenHandler = origGetCurrentHandler
    ;(ToolsObserve as any).getScreenFingerprintHandler = origGetFpHandler
    ;(ToolsObserve as any).getUITreeHandler = origGetTreeHandler
    ;(ToolsObserve as any).readLogStreamHandler = origReadLogStreamHandler
    ;(ToolsObserve as any).getLogsHandler = origGetLogsHandler

    // --- Test 2: screenshot and ui tree fail; logs fallback to getLogs ---
    ;(ToolsObserve as any).captureScreenshotHandler = async function() { throw new Error('screencap failed') }
    ;(ToolsObserve as any).getUITreeHandler = async function() { throw new Error('uie_error') }
    ;(ToolsObserve as any).readLogStreamHandler = async function() { return { entries: [] } }
    ;(ToolsObserve as any).getLogsHandler = async function() { return { device: { platform: 'android', id: 'mock' }, logs: ['INFO starting','ERROR crash here'], logCount: 2 } }

    const res2: any = await ToolsObserve.captureDebugSnapshotHandler({ platform: 'android', includeLogs: true, logLines: 10, appId: 'com.example' })
    console.log('res2:', JSON.stringify(res2, null, 2))
    const pass2 = res2 && res2.screenshot_error && res2.ui_tree_error && Array.isArray(res2.logs) && res2.logs.length === 2
    console.log('Test 2:', pass2 ? 'PASS' : 'FAIL')

    // Restore handlers before next test
    ;(ToolsObserve as any).captureScreenshotHandler = origCaptureHandler
    ;(ToolsObserve as any).getCurrentScreenHandler = origGetCurrentHandler
    ;(ToolsObserve as any).getScreenFingerprintHandler = origGetFpHandler
    ;(ToolsObserve as any).getUITreeHandler = origGetTreeHandler
    ;(ToolsObserve as any).readLogStreamHandler = origReadLogStreamHandler
    ;(ToolsObserve as any).getLogsHandler = origGetLogsHandler

    // --- Test 3: includeLogs=false should omit logs ---
    ;(ToolsObserve as any).captureScreenshotHandler = async function() { return { device: { platform: 'android', id: 'mock' }, screenshot: null } }
    ;(ToolsObserve as any).getCurrentScreenHandler = async function() { return { device: { platform: 'android', id: 'mock' }, package: '', activity: '', shortActivity: '' } }
    ;(ToolsObserve as any).getScreenFingerprintHandler = async function() { return { fingerprint: null } }
    ;(ToolsObserve as any).getUITreeHandler = async function() { return { device: { platform: 'android', id: 'mock' }, screen: '', resolution: { width: 0, height: 0 }, elements: [] } }
    ;(ToolsObserve as any).readLogStreamHandler = async function() { return { entries: [] } }

    const res3: any = await ToolsObserve.captureDebugSnapshotHandler({ platform: 'android', includeLogs: false })
    console.log('res3:', JSON.stringify(res3, null, 2))
    const pass3 = res3 && typeof res3.logs !== 'undefined' && res3.logs.length === 0
    console.log('Test 3:', pass3 ? 'PASS' : 'FAIL')

  } finally {
    ;(ToolsObserve as any).captureScreenshotHandler = origCaptureHandler
    ;(ToolsObserve as any).getCurrentScreenHandler = origGetCurrentHandler
    ;(ToolsObserve as any).getScreenFingerprintHandler = origGetFpHandler
    ;(ToolsObserve as any).getUITreeHandler = origGetTreeHandler
    ;(ToolsObserve as any).readLogStreamHandler = origReadLogStreamHandler
    ;(ToolsObserve as any).getLogsHandler = origGetLogsHandler
  }
}

run().catch(console.error)
