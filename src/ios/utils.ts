import { execFile, spawn } from "child_process"
import { DeviceInfo } from "../types.js"

export const XCRUN = process.env.XCRUN_PATH || "xcrun"
export const IDB = "idb"

export interface IOSResult {
  output: string
  device: DeviceInfo
}

// Validate bundle ID to prevent any potential injection or invalid characters
export function validateBundleId(bundleId: string) {
  if (!bundleId) return
  // Allow alphanumeric, dots, hyphens, and underscores.
  if (!/^[a-zA-Z0-9.\-_]+$/.test(bundleId)) {
    throw new Error(`Invalid Bundle ID: ${bundleId}. Must contain only alphanumeric characters, dots, hyphens, or underscores.`)
  }
}

export function execCommand(args: string[], deviceId: string = "booted"): Promise<IOSResult> {
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
