import { ToolsInteract } from '../../../src/interact/index.js'
import { ToolsObserve } from '../../../src/observe/index.js'

const origGet = (ToolsObserve as any).getUITreeHandler
const origSwipe = (ToolsInteract as any).swipeHandler

async function runTests() {
  // Use a stable logger to avoid test harness replacing console.log between calls
  console.log = (...args: any[]) => { try { process.stdout.write(args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') + '\n') } catch {} }
  console.log('Starting tests for scroll_to_element...')

  // Test 1: Element found immediately
  console.log('\nTest 1: Element found immediately')
  (ToolsObserve as any).getUITreeHandler = async () => ({
    device: { platform: 'android', id: 'mock', osVersion: '12', model: 'Pixel', simulator: true },
    screen: '',
    resolution: { width: 1080, height: 1920 },
    elements: [{
      text: 'Target',
      type: 'Button',
      contentDescription: null,
      clickable: true,
      enabled: true,
      visible: true,
      bounds: [0, 0, 100, 100],
      resourceId: null
    }]
  })

  const res1 = await ToolsInteract.scrollToElementHandler({ platform: 'android', selector: { text: 'Target' }, direction: 'down', maxScrolls: 5, scrollAmount: 0.7 })
  console.log('Result:', res1.success === true ? 'PASS' : 'FAIL')
  console.log('scrollsPerformed:', (res1 as any).scrollsPerformed)

  // Test 2: Element found after scrolling
  console.log('\nTest 2: Element found after scrolling')
  let calls = 0
  (ToolsObserve as any).getUITreeHandler = async () => {
    calls++
    if (calls < 3) {
      return {
        device: { platform: 'android', id: 'mock', osVersion: '12', model: 'Pixel', simulator: true },
        screen: '',
        resolution: { width: 1080, height: 1920 },
        elements: []
      }
    }
    return {
      device: { platform: 'android', id: 'mock', osVersion: '12', model: 'Pixel', simulator: true },
      screen: '',
      resolution: { width: 1080, height: 1920 },
      elements: [{
        text: 'Target',
        type: 'Button',
        contentDescription: null,
        clickable: true,
        enabled: true,
        visible: true,
        bounds: [0, 0, 100, 100],
        resourceId: null
      }]
    }
  }

  // Stub swipe so it doesn't try to call adb/idb
  (ToolsInteract as any).swipeHandler = async () => ({ success: true })

  const res2 = await ToolsInteract.scrollToElementHandler({ platform: 'android', selector: { text: 'Target' }, direction: 'down', maxScrolls: 5, scrollAmount: 0.7 })
  console.log('Result:', res2.success === true ? 'PASS' : 'FAIL')
  console.log('calls:', calls, calls >= 3 ? 'PASS' : 'FAIL')

  // Test 3: UI unchanged stops early
  console.log('\nTest 3: UI unchanged stops early')
  (ToolsObserve as any).getUITreeHandler = async () => ({
    device: { platform: 'android', id: 'mock', osVersion: '12', model: 'Pixel', simulator: true },
    screen: '',
    resolution: { width: 1080, height: 1920 },
    elements: []
  })

  (ToolsInteract as any).swipeHandler = async () => ({ success: true })

  const res3 = await ToolsInteract.scrollToElementHandler({ platform: 'android', selector: { text: 'Missing' }, direction: 'down', maxScrolls: 5, scrollAmount: 0.7 })
  console.log('Result:', res3.success === false && (res3 as any).attempts === 1 ? 'PASS' : 'FAIL')
  console.log('Reason:', (res3 as any).reason || JSON.stringify(res3))

  // Test 4: Offscreen element scrolls into view
  console.log('\nTest 4: Offscreen element scrolls into view')
  const ai = new (await import('../../../src/interact/index.js')).AndroidInteract()
  const origObserveGet = ai['observe'].getUITree
  const origAiSwipe = ai.swipe
  let swiped = false
  let swipeCalled = 0
  ;(ai['observe'] as any).getUITree = async () => {
    if (!swiped) {
      return {
        device: { platform: 'android', id: 'mock', osVersion: '12', model: 'Pixel', simulator: true },
        screen: '',
        resolution: { width: 1080, height: 1920 },
        elements: [ { text: null, type: 'android.view.View', resourceId: null, contentDescription: null, bounds: [0,0,1080,200], visible: true } ]
      }
    }
    return {
      device: { platform: 'android', id: 'mock', osVersion: '12', model: 'Pixel', simulator: true },
      screen: '',
      resolution: { width: 1080, height: 1920 },
      elements: [{ text: 'OffscreenTarget', type: 'android.widget.Button', contentDescription: null, clickable: true, enabled: true, visible: true, bounds: [100,400,300,460], resourceId: null }]
    }
  }
  ;(ai as any).swipe = async () => { swipeCalled++; swiped = true; return { success: true } }

  const r4 = await ai.scrollToElement({ text: 'OffscreenTarget' }, 'down', 3, 0.7, 'mock')
  const ok4 = r4 && (r4 as any).success === true && (r4 as any).scrollsPerformed === 1 && swipeCalled === 1
  console.log('Result:', ok4 ? 'PASS' : 'FAIL')
  console.log('  success:', (r4 as any).success, 'scrollsPerformed:', (r4 as any).scrollsPerformed, 'swipeCalled:', swipeCalled)

  ;(ai['observe'] as any).getUITree = origObserveGet
  ;(ai as any).swipe = origAiSwipe

  // Restore
  (ToolsObserve as any).getUITreeHandler = origGet
  ;(ToolsInteract as any).swipeHandler = origSwipe
}

// Ensure console.log is a function (some test runners replace it)
if (typeof console.log !== 'function') {
  console.log = (...args: any[]) => { try { process.stdout.write(args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') + '\n') } catch { /* swallow */ } }
}

runTests().catch(console.error)
