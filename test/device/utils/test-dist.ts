import fs from 'fs/promises'
import { listAndroidDevices } from '../../../dist/android/utils.js'
import { getAndroidLogs, captureAndroidScreen } from '../../../dist/android.js'

async function main() {
  try {
    console.log('Listing Android devices...')
    const devices = await listAndroidDevices()
    console.log('Devices:', JSON.stringify(devices, null, 2))

    if (devices.length === 0) {
      console.log('No Android devices found; aborting Android smoke test.')
      return
    }

    const target = devices[0]
    console.log('Using target device:', target.id)

    console.log('Fetching logs (last 50 lines)...')
    const logsRes = await getAndroidLogs(undefined, 50, target.id)
    console.log(`Retrieved ${logsRes.logCount} log lines`)
    if (logsRes.logs && logsRes.logs.length > 0) {
      console.log('Sample log:', logsRes.logs[Math.max(0, logsRes.logs.length - 1)].substring(0, 200))
    }

    console.log('Capturing screenshot...')
    const shot = await captureAndroidScreen(target.id)
    if (shot && shot.screenshot) {
      const file = `smoke-test-android-${target.id}.png`
      await fs.writeFile(file, Buffer.from(shot.screenshot, 'base64'))
      console.log('Screenshot saved to', file)
    } else {
      console.log('No screenshot returned')
    }
  } catch {
    console.error('Smoke test script failed:', err)
    process.exit(1)
  }
}

main()
