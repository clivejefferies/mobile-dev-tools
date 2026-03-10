import { spawn } from "child_process"
import { DeviceInfo } from "../types.js"

export const ADB = process.env.ADB_PATH || "adb"

// Helper to construct ADB args with optional device ID
function getAdbArgs(args: string[], deviceId?: string): string[] {
  if (deviceId) {
    return ['-s', deviceId, ...args]
  }
  return args
}

export function execAdb(args: string[], deviceId?: string, options: any = {}): Promise<string> {
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

    let timeoutMs = 2000;
    if (args.includes('logcat')) {
        timeoutMs = 10000;
    } else if (args.includes('uiautomator') && args.includes('dump')) {
        timeoutMs = 20000; // UI dump can be slow
    }

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

export function getDeviceInfo(deviceId: string, metadata: Partial<DeviceInfo> = {}): DeviceInfo {
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
