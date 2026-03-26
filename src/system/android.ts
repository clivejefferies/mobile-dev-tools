import { execSync } from 'child_process'
import { ensureAdbAvailable } from '../utils/android/utils.js'

export async function checkAndroid() {
  const issues: string[] = []
  let adbAvailable = false
  let adbVersion = ''
  let devices = 0
  let deviceStates = ''
  let logsAvailable = false
  let envValid = false
  let appInstalled: boolean | undefined = undefined

  try {
    const adbCheck = ensureAdbAvailable()
    const adbCmd = adbCheck.adbCmd || 'adb'
    adbAvailable = !!adbCheck.ok
    adbVersion = (adbCheck.version || '').toString().split('\n')[0]
    if (!adbAvailable) issues.push('ADB not available')

    try {
      const out = execSync(`${adbCmd} devices -l`, { encoding: 'utf8', timeout: 1500, stdio: ['ignore','pipe','ignore'] }).toString()
      const lines = out.split('\n').map(l => l.trim()).filter(Boolean)
      const deviceLines = lines.filter(l => !l.startsWith('List of devices'))
      const stateCounts: Record<string, number> = {}
      for (const l of deviceLines) {
        const parts = l.split(/\s+/)
        const state = parts[1] || ''
        stateCounts[state] = (stateCounts[state] || 0) + 1
      }
      devices = deviceLines.length
      const parts = Object.entries(stateCounts).map(([k,v]) => `${v} ${k}`)
      deviceStates = parts.join(', ')
      if (devices === 0) issues.push('No Android devices connected')
      if (stateCounts['unauthorized']) issues.push(`${stateCounts['unauthorized']} device(s) unauthorized`)
      if (stateCounts['offline']) issues.push(`${stateCounts['offline']} device(s) offline`)
    } catch (e: unknown) { console.debug('[get_system_status] adb devices failed: ' + String(e)); issues.push('Failed to list Android devices') }

    if (adbAvailable && devices > 0) {
      try {
        const lo = execSync(`${adbCmd} logcat -d -t 1`, { encoding: 'utf8', timeout: 1500, stdio: ['ignore','pipe','ignore'] }).toString()
        logsAvailable = !!lo
        if (!logsAvailable) issues.push('Log access failed')
      } catch (e: unknown) { logsAvailable = false; console.debug('[get_system_status] logcat check failed: ' + String(e)) }
    }

    const sdkRoot = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME
    envValid = !!sdkRoot || (adbAvailable === true && !!(adbCheck.adbCmd && adbCheck.adbCmd !== 'adb'))
    if (!envValid) issues.push('ANDROID_SDK_ROOT/ANDROID_HOME missing and adb not found in PATH')

    const pkg = process.env.MCP_TARGET_PACKAGE || process.env.MCP_TARGET_APP_ID
    if (pkg && adbAvailable && devices > 0) {
      try {
        const pm = execSync(`${adbCmd} shell pm path ${pkg}`, { encoding: 'utf8', timeout: 1500, stdio: ['ignore','pipe','ignore'] }).toString()
        appInstalled = (pm || '').includes('package:')
        if (!appInstalled) issues.push(`App ${pkg} not installed on devices`)
      } catch (e: unknown) { appInstalled = false; console.debug('[get_system_status] pm check failed: ' + String(e)) }
    }
  } catch (e: unknown) { console.debug('[get_system_status] adb availability check failed: ' + String(e)); issues.push('ADB check failed') }

  return { adbAvailable, adbVersion, devices, deviceStates, logsAvailable, envValid, appInstalled, issues }
}
