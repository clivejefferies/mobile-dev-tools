#!/usr/bin/env node
/**
 * Device E2E: get_screen_fingerprint
 * Usage: RUN_DEVICE_TESTS=true npx tsx run-screen-fingerprint.ts [android|ios] [deviceId]
 */

import { AndroidObserve } from '../../../src/android/observe.js'
import { iOSObserve } from '../../../src/ios/observe.js'

async function main() {
  const args = process.argv.slice(2)
  const platform = (args[0] || 'android').toLowerCase()
  const deviceId = args[1]

  console.log(`Running screen fingerprint test for ${platform}${deviceId ? ` on ${deviceId}` : ''}`)

  try {
    if (platform === 'ios') {
      const obs = new iOSObserve()
      const res = await obs.getScreenFingerprint(deviceId || 'booted')
      if (res.error || !res.fingerprint) {
        console.error('❌ Failed to compute fingerprint:', res.error)
        process.exit(1)
      }
      console.log('Fingerprint:', res.fingerprint)
      console.log('Activity:', res.activity || '<n/a>')
      process.exit(0)
    } else {
      const obs = new AndroidObserve()
      const res = await obs.getScreenFingerprint(deviceId)
      if (res.error || !res.fingerprint) {
        console.error('❌ Failed to compute fingerprint:', res.error)
        process.exit(1)
      }
      console.log('Fingerprint:', res.fingerprint)
      console.log('Activity:', res.activity || '<n/a>')
      process.exit(0)
    }
  } catch (err) {
    console.error('❌ Test failed:', err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}

main()
