import { ToolsInteract } from '../../../../src/interact/index.js'
import * as Observe from '../../../../src/observe/index.js'

async function run() {
  console.log('Unit: observe_until edge cases')

  const origFind = (ToolsInteract as any).findElementHandler
  const origFp = (Observe as any).ToolsObserve.getScreenFingerprintHandler

  try {
    // 1) Immediate absence should pass for match='absent'
    (ToolsInteract as any).findElementHandler = async () => ({ found: false })
    const r1 = await (ToolsInteract as any).observeUntilHandler({ type: 'ui', query: 'Nothing', timeoutMs: 2000, pollIntervalMs: 100, stability_ms: 200, match: 'absent', platform: 'android' })
    console.log('Immediate absent test:', r1 && (r1 as any).success ? 'PASS' : 'FAIL', JSON.stringify({ poll_count: (r1 as any).poll_count, duration_ms: (r1 as any).duration_ms, stable_duration_ms: (r1 as any).stable_duration_ms, matchSource: (r1 as any).matchSource }, null, 2))

    // 2) Boundary stability: condition becomes true and stays exactly long enough
    // Use pollInterval 100ms and stability 300ms -> need ~3 consecutive trues
    let seq2 = [false, true, true, true]
    (ToolsInteract as any).findElementHandler = async () => ({ found: seq2.shift() ?? true })
    const r2 = await (ToolsInteract as any).observeUntilHandler({ type: 'ui', query: 'Boundary', timeoutMs: 2000, pollIntervalMs: 100, stability_ms: 300, match: 'present', platform: 'android' })
    console.log('Boundary stability test:', r2 && (r2 as any).success ? 'PASS' : 'FAIL', JSON.stringify({ poll_count: (r2 as any).poll_count, duration_ms: (r2 as any).duration_ms, stable_duration_ms: (r2 as any).stable_duration_ms, matchSource: (r2 as any).matchSource }, null, 2))

    // 3) Long flicker that never stabilizes should timeout/fail
    // Sequence toggles true/false repeatedly
    let seq3 = [false, true, false, true, false, true, false]
    (ToolsInteract as any).findElementHandler = async () => ({ found: seq3.shift() ?? false })
    const r3 = await (ToolsInteract as any).observeUntilHandler({ type: 'ui', query: 'Flicker', timeoutMs: 1200, pollIntervalMs: 150, stability_ms: 400, match: 'present', platform: 'android' })
    console.log('Long flicker timeout test:', !(r3 && (r3 as any).success) ? 'PASS' : 'FAIL', JSON.stringify({ poll_count: (r3 as any).poll_count, duration_ms: (r3 as any).duration_ms, stable_duration_ms: (r3 as any).stable_duration_ms, matchSource: (r3 as any).matchSource }, null, 2))

    // 4) Very short stability requirement should pass quickly
    (ToolsInteract as any).findElementHandler = async () => ({ found: true })
    const r4 = await (ToolsInteract as any).observeUntilHandler({ type: 'ui', query: 'ShortStable', timeoutMs: 2000, pollIntervalMs: 200, stability_ms: 50, match: 'present', platform: 'android' })
    console.log('Short stability test:', r4 && (r4 as any).success ? 'PASS' : 'FAIL', JSON.stringify({ poll_count: (r4 as any).poll_count, duration_ms: (r4 as any).duration_ms, stable_duration_ms: (r4 as any).stable_duration_ms, matchSource: (r4 as any).matchSource }, null, 2))

  } finally {
    (ToolsInteract as any).findElementHandler = origFind
    (Observe as any).ToolsObserve.getScreenFingerprintHandler = origFp
  }
}

run().catch(e=>{ console.error(e); process.exit(1) })
