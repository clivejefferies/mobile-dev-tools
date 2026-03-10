import { execFile, spawn } from "child_process"
import { promises as fs } from "fs"
import { pathToFileURL } from "url"
import { StartAppResponse, GetLogsResponse, GetCrashResponse, CaptureIOSScreenshotResponse, TerminateAppResponse, RestartAppResponse, ResetAppDataResponse, DeviceInfo } from "./types.js"

const XCRUN = process.env.XCRUN_PATH || "xcrun"

interface IOSResult {
  output: string
  device: DeviceInfo
}

// Validate bundle ID to prevent any potential injection or invalid characters
function validateBundleId(bundleId: string) {
  if (!bundleId) return
  // Allow alphanumeric, dots, hyphens, and underscores.
  if (!/^[a-zA-Z0-9.\-_]+$/.test(bundleId)) {
    throw new Error(`Invalid Bundle ID: ${bundleId}. Must contain only alphanumeric characters, dots, hyphens, or underscores.`)
  }
}

function execCommand(args: string[], deviceId: string = "booted"): Promise<IOSResult> {
  return new Promise((resolve, reject) => {
    // Use spawn for better stream control and consistency with Android implementation
    const child = spawn(XCRUN, args)
    
    let stdout = ''
    let stderr = ''

    if (child.stdout) {
      child.stdout.on('data', (data) => {
        stdout += data.toString()
      })
    }

    if (child.stderr) {
      child.stderr.on('data', (data) => {
        stderr += data.toString()
      })
    }

    const timeoutMs = args.includes('log') ? 10000 : 5000 // 10s for logs, 5s for others
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(`Command timed out after ${timeoutMs}ms: ${XCRUN} ${args.join(' ')}`))
    }, timeoutMs)

    child.on('close', (code) => {
      clearTimeout(timeout)
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Command failed with code ${code}`))
      } else {
        resolve({ output: stdout.trim(), device: { platform: "ios", id: deviceId } as DeviceInfo })
      }
    })

    child.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}

function parseRuntimeName(runtime: string): string {
  // Example: com.apple.CoreSimulator.SimRuntime.iOS-17-0 -> iOS 17.0
  try {
    const parts = runtime.split('.')
    const lastPart = parts[parts.length - 1]
    return lastPart.replace(/-/g, ' ').replace('iOS ', 'iOS ') // Keep iOS prefix
  } catch {
    return runtime
  }
}

export async function getIOSDeviceMetadata(deviceId: string = "booted"): Promise<DeviceInfo> {
  return new Promise((resolve) => {
    // If deviceId is provided (and not "booted"), we could try to list just that device.
    // But listing all booted devices is usually fine to find the one we want or just one.
    // Let's stick to listing all and filtering if needed, or just return basic info if we can't find it.
    execFile(XCRUN, ['simctl', 'list', 'devices', 'booted', '--json'], (err, stdout) => {
      // Default fallback
      const fallback: DeviceInfo = {
        platform: "ios",
        id: deviceId,
        osVersion: "Unknown",
        model: "Simulator",
        simulator: true,
      }

      if (err || !stdout) {
        resolve(fallback)
        return
      }

      try {
        const data = JSON.parse(stdout)
        const devicesMap = data.devices || {}
        
        // Find the device
        for (const runtime in devicesMap) {
          const devices = devicesMap[runtime]
          if (Array.isArray(devices)) {
            for (const device of devices) {
              if (deviceId === "booted" || device.udid === deviceId) {
                 resolve({
                  platform: "ios",
                  id: device.udid,
                  osVersion: parseRuntimeName(runtime),
                  model: device.name,
                  simulator: true,
                })
                return
              }
            }
          }
        }
        resolve(fallback)
      } catch (error) {
        resolve(fallback)
      }
    })
  })
}

export async function startIOSApp(bundleId: string, deviceId: string = "booted"): Promise<StartAppResponse> {
  validateBundleId(bundleId)
  const result = await execCommand(['simctl', 'launch', deviceId, bundleId], deviceId)
  const device = await getIOSDeviceMetadata(deviceId)
  // Simulate launch time and appStarted for demonstration
  return {
    device,
    appStarted: !!result.output,
    launchTimeMs: 1000,
  }
}

export async function terminateIOSApp(bundleId: string, deviceId: string = "booted"): Promise<TerminateAppResponse> {
  validateBundleId(bundleId)
  await execCommand(['simctl', 'terminate', deviceId, bundleId], deviceId)
  const device = await getIOSDeviceMetadata(deviceId)
  return {
    device,
    appTerminated: true
  }
}

export async function restartIOSApp(bundleId: string, deviceId: string = "booted"): Promise<RestartAppResponse> {
  // terminateIOSApp already validates bundleId
  await terminateIOSApp(bundleId, deviceId)
  const startResult = await startIOSApp(bundleId, deviceId)
  return {
    device: startResult.device,
    appRestarted: startResult.appStarted,
    launchTimeMs: startResult.launchTimeMs
  }
}

export async function resetIOSAppData(bundleId: string, deviceId: string = "booted"): Promise<ResetAppDataResponse> {
  validateBundleId(bundleId)
  await terminateIOSApp(bundleId, deviceId)
  const device = await getIOSDeviceMetadata(deviceId)
  
  // Get data container path
  const containerResult = await execCommand(['simctl', 'get_app_container', deviceId, bundleId, 'data'], deviceId)
  const dataPath = containerResult.output.trim()
  
  if (!dataPath) {
    throw new Error(`Could not find data container for ${bundleId}`)
  }

  // Clear contents of Library and Documents
  try {
    const libraryPath = `${dataPath}/Library`
    const documentsPath = `${dataPath}/Documents`
    const tmpPath = `${dataPath}/tmp`
    
    await fs.rm(libraryPath, { recursive: true, force: true }).catch(() => {})
    await fs.rm(documentsPath, { recursive: true, force: true }).catch(() => {})
    await fs.rm(tmpPath, { recursive: true, force: true }).catch(() => {})

    // Re-create empty directories as they are expected by apps
    await fs.mkdir(libraryPath, { recursive: true }).catch(() => {})
    await fs.mkdir(documentsPath, { recursive: true }).catch(() => {})
    await fs.mkdir(tmpPath, { recursive: true }).catch(() => {})
    
    return {
      device,
      dataCleared: true
    }
  } catch (err) {
    throw new Error(`Failed to clear data for ${bundleId}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export async function getIOSLogs(appId?: string, deviceId: string = "booted"): Promise<GetLogsResponse> {
  // If appId is provided, use predicate filtering
  // Note: execFile passes args directly, so we don't need shell escaping for the predicate string itself,
  // but we do need to construct the predicate correctly for log show.
  const args = ['simctl', 'spawn', deviceId, 'log', 'show', '--style', 'syslog', '--last', '1m']
  if (appId) {
    validateBundleId(appId)
    args.push('--predicate', `subsystem contains "${appId}" or process == "${appId}"`)
  }
  
  const result = await execCommand(args, deviceId)
  const device = await getIOSDeviceMetadata(deviceId)
  const logs = result.output ? result.output.split('\n') : []
  return {
    device,
    logs,
    logCount: logs.length,
  }
}


export async function captureIOSScreenshot(deviceId: string = "booted"): Promise<CaptureIOSScreenshotResponse> {
  const device = await getIOSDeviceMetadata(deviceId)
  const tmpFile = `/tmp/mcp-ios-screenshot-${Date.now()}.png`

  try {
    // 1. Capture screenshot to temp file
    await execCommand(['simctl', 'io', deviceId, 'screenshot', tmpFile], deviceId)
    
    // 2. Read file as base64
    const buffer = await fs.readFile(tmpFile)
    const base64 = buffer.toString('base64')
    
    // 3. Clean up
    await fs.rm(tmpFile).catch(() => {})

    return {
      device,
      screenshot: base64,
      // Default resolution since we can't easily parse it without extra libs
      // Clients will read the real dimensions from the PNG header anyway
      resolution: { width: 0, height: 0 },
    }
  } catch (err) {
    // Ensure cleanup happens even on error
    await fs.rm(tmpFile).catch(() => {})
    throw new Error(`Failed to capture screenshot: ${err instanceof Error ? err.message : String(err)}`)
  }
}