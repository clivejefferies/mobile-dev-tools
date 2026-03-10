import { execFile, spawn } from "child_process"
import { StartAppResponse, GetLogsResponse, CaptureAndroidScreenResponse, TerminateAppResponse, RestartAppResponse, ResetAppDataResponse, DeviceInfo } from "./types.js"

const ADB = process.env.ADB_PATH || "adb"

// Helper to construct ADB args with optional device ID
function getAdbArgs(args: string[], deviceId?: string): string[] {
  if (deviceId) {
    return ['-s', deviceId, ...args]
  }
  return args
}

function execAdb(args: string[], deviceId?: string, options: any = {}): Promise<string> {
  const adbArgs = getAdbArgs(args, deviceId)
  return new Promise((resolve, reject) => {
    // Use spawn instead of execFile for better stream control and to avoid potential buffering hangs
    const child = spawn(ADB, adbArgs, options)
    
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

    const timeoutMs = args.includes('logcat') ? 10000 : 2000 // Shorter timeout for metadata queries
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(`ADB command timed out after ${timeoutMs}ms: ${args.join(' ')}`))
    }, timeoutMs)

    child.on('close', (code) => {
      clearTimeout(timeout)
      if (code !== 0) {
        // If there's an actual error (non-zero exit code), reject
        reject(new Error(stderr.trim() || `Command failed with code ${code}`))
      } else {
        // If exit code is 0, resolve with stdout
        resolve(stdout.trim())
      }
    })

    child.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}

function getDeviceInfo(deviceId: string, metadata: Partial<DeviceInfo> = {}): DeviceInfo {
  return { 
    platform: 'android', 
    id: deviceId || 'default', 
    osVersion: metadata.osVersion || '', 
    model: metadata.model || '', 
    simulator: metadata.simulator || false 
  }
}

export async function getAndroidDeviceMetadata(appId: string, deviceId?: string): Promise<DeviceInfo> {
  try {
    // Run these in parallel to avoid sequential timeouts
    const [osVersion, model, simOutput] = await Promise.all([
      execAdb(['shell', 'getprop', 'ro.build.version.release'], deviceId).catch(() => ''),
      execAdb(['shell', 'getprop', 'ro.product.model'], deviceId).catch(() => ''),
      execAdb(['shell', 'getprop', 'ro.kernel.qemu'], deviceId).catch(() => '0')
    ])
    
    const simulator = simOutput === '1'
    return { platform: 'android', id: deviceId || 'default', osVersion, model, simulator }
  } catch (e) {
    return { platform: 'android', id: deviceId || 'default', osVersion: '', model: '', simulator: false }
  }
}

export async function startAndroidApp(appId: string, deviceId?: string): Promise<StartAppResponse> {
  const metadata = await getAndroidDeviceMetadata(appId, deviceId)
  const deviceInfo = getDeviceInfo(deviceId || 'default', metadata)
  
  await execAdb(['shell', 'monkey', '-p', appId, '-c', 'android.intent.category.LAUNCHER', '1'], deviceId)
  
  return { device: deviceInfo, appStarted: true, launchTimeMs: 1000 }
}

export async function terminateAndroidApp(appId: string, deviceId?: string): Promise<TerminateAppResponse> {
  const metadata = await getAndroidDeviceMetadata(appId, deviceId)
  const deviceInfo = getDeviceInfo(deviceId || 'default', metadata)

  await execAdb(['shell', 'am', 'force-stop', appId], deviceId)
  
  return { device: deviceInfo, appTerminated: true }
}

export async function restartAndroidApp(appId: string, deviceId?: string): Promise<RestartAppResponse> {
  await terminateAndroidApp(appId, deviceId)
  const startResult = await startAndroidApp(appId, deviceId)
  return {
    device: startResult.device,
    appRestarted: startResult.appStarted,
    launchTimeMs: startResult.launchTimeMs
  }
}

export async function resetAndroidAppData(appId: string, deviceId?: string): Promise<ResetAppDataResponse> {
  const metadata = await getAndroidDeviceMetadata(appId, deviceId)
  const deviceInfo = getDeviceInfo(deviceId || 'default', metadata)

  const output = await execAdb(['shell', 'pm', 'clear', appId], deviceId)
  
  return { device: deviceInfo, dataCleared: output === 'Success' }
}

export async function getAndroidLogs(appId?: string, lines = 200, deviceId?: string): Promise<GetLogsResponse> {
  const metadata = await getAndroidDeviceMetadata(appId || "", deviceId)
  const deviceInfo = getDeviceInfo(deviceId || 'default', metadata)

  try {
    // We'll skip PID lookup for now to avoid potential hangs with 'pidof' on some emulators
    // and rely on robust string matching against the log line.
    
    // Get logs
    const stdout = await execAdb(['logcat', '-d', '-t', lines.toString(), '-v', 'threadtime'], deviceId)
    const allLogs = stdout.split('\n')
    
    let filteredLogs = allLogs
    if (appId) {
       // Filter by checking if the line contains the appId string.
       const matchingLogs = allLogs.filter(line => line.includes(appId))
       
       if (matchingLogs.length > 0) {
         filteredLogs = matchingLogs
       } else {
         // Fallback: if no logs match the appId, return the raw logs (last N lines)
         // This matches the behavior of the "working" version provided by the user,
         // ensuring they at least see system activity if the app is silent or crashing early.
         filteredLogs = allLogs
       }
    }
    
    return { device: deviceInfo, logs: filteredLogs, logCount: filteredLogs.length }
  } catch (e) {
    console.error("Error fetching logs:", e)
    return { device: deviceInfo, logs: [], logCount: 0 }
  }
}

export async function captureAndroidScreen(deviceId?: string): Promise<CaptureAndroidScreenResponse> {
  const metadata = await getAndroidDeviceMetadata("", deviceId)
  const deviceInfo: DeviceInfo = getDeviceInfo(deviceId || 'default', metadata)

  return new Promise((resolve, reject) => {
    const adbArgs = getAdbArgs(['exec-out', 'screencap', '-p'], deviceId)
    
    // Using spawn for screencap as well to ensure consistent process handling
    const child = spawn(ADB, adbArgs)
    
    const chunks: Buffer[] = []
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      chunks.push(Buffer.from(chunk))
    })

    child.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(`ADB screencap timed out after 10s`))
    }, 10000)

    child.on('close', (code) => {
      clearTimeout(timeout)
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Screencap failed with code ${code}`))
        return
      }

      const screenshotBuffer = Buffer.concat(chunks)
      const screenshotBase64 = screenshotBuffer.toString('base64')

      // Get resolution
      execAdb(['shell', 'wm', 'size'], deviceId)
        .then(sizeStdout => {
          let width = 0
          let height = 0
          const match = sizeStdout.match(/Physical size: (\d+)x(\d+)/)
          if (match) {
            width = parseInt(match[1], 10)
            height = parseInt(match[2], 10)
          }
          resolve({
            device: deviceInfo,
            screenshot: screenshotBase64,
            resolution: { width, height }
          })
        })
        .catch(() => {
           resolve({
            device: deviceInfo,
            screenshot: screenshotBase64,
            resolution: { width: 0, height: 0 }
          })
        })
    })

    child.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}