#!/usr/bin/env node
import { AndroidInteract } from '../../../dist/android/interact.js'


// Usage: tsx test/device/observe/run-scroll-test-android.ts <deviceId> <appId> <selectorText>
const args = process.argv.slice(2)
const DEVICE_ID = args[0] || process.env.DEVICE_ID || 'emulator-5554'
const SELECTOR = args[2] || process.env.SELECTOR || 'Generate Session'

async function main() {
  console.log('Starting app if not running...')
  // Best-effort tap to wake device/emulator
  try { const tmp = new AndroidInteract(); await tmp.tap(10,10, DEVICE_ID).catch(()=>{}) } catch {}
  await new Promise(r => setTimeout(r, 1000))

  console.log('Running scroll_to_element for selector:', SELECTOR)
  // Use ToolsInteract from dist to call the handler
  const ToolsInteract = (await import('../../../dist/tools/interact.js')).ToolsInteract

  const res = await (ToolsInteract as any).scrollToElementHandler({ platform: 'android', selector: { text: SELECTOR }, direction: 'down', maxScrolls: 10, scrollAmount: 0.7, deviceId: DEVICE_ID })
  console.log('Result:', JSON.stringify(res, null, 2))
}

main().catch(console.error)
