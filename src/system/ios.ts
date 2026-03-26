import { execSync } from 'child_process'
import { getXcrunCmd } from '../utils/ios/utils.js'

export async function checkIOS() {
  const issues: string[] = []
  let iosAvailable = false
  let iosDevices = 0
  try {
    const xcrun = getXcrunCmd()
    try {
      execSync(`${xcrun} --version`, { stdio: ['ignore','pipe','ignore'], timeout: 1500 })
      iosAvailable = true
      try {
        const simOut = execSync(`${xcrun} simctl list devices booted --json`, { encoding: 'utf8', timeout: 1500, stdio: ['ignore','pipe','ignore'] })
        const data = JSON.parse(simOut)
        type SimDevice = { state?: string }
        let count = 0
        for (const k in data.devices) {
          const arr = data.devices[k]
          if (Array.isArray(arr)) count += arr.filter((d: SimDevice) => (d.state || '').toLowerCase() === 'booted').length
        }
        iosDevices = count
        if (iosDevices === 0) issues.push('No iOS simulators/devices booted')
      } catch (e: unknown) { console.debug('[get_system_status] simctl list failed: ' + String(e)) }
    } catch (e: unknown) { iosAvailable = false; console.debug('[get_system_status] xcrun --version failed: ' + String(e)) }
  } catch (e: unknown) { console.debug('[get_system_status] xcrun check failed: ' + String(e)) }
  return { iosAvailable, iosDevices, issues }
}
