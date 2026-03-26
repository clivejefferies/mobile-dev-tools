import { checkAndroid } from './android.js'
import { checkIOS } from './ios.js'

export async function getSystemStatus() {
  try {
    const android = await checkAndroid()
    const ios = await checkIOS()
    const issues = [...android.issues, ...ios.issues]

    const success = issues.length === 0
    return {
      success,
      adbAvailable: android.adbAvailable,
      adbVersion: android.adbVersion,
      devices: android.devices,
      deviceStates: android.deviceStates,
      logsAvailable: android.logsAvailable,
      envValid: android.envValid,
      issues,
      appInstalled: android.appInstalled,
      iosAvailable: ios.iosAvailable,
      iosDevices: ios.iosDevices
    }
  } catch (e: unknown) {
    return { success: false, issues: ['Internal error: ' + (e instanceof Error ? e.message : String(e))] }
  }
}
