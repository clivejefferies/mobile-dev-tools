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
    const lastPart = parts[parts.length - 1] // e.g. "iOS-17-0"
    
    // Split by hyphen to separate OS from version numbers
    // e.g. "iOS-17-0" -> ["iOS", "17", "0"]
    const segments = lastPart.split('-');
    
    if (segments.length > 1) {
        const os = segments[0]; // "iOS"
        const version = segments.slice(1).join('.'); // "17.0"
        return `${os} ${version}`;
    }
    
    return lastPart;
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

export async function listIOSDevices(appId?: string): Promise<DeviceInfo[]> {
  return new Promise((resolve) => {
    execFile(XCRUN, ['simctl', 'list', 'devices', '--json'], (err, stdout) => {
      if (err || !stdout) return resolve([])
      try {
        const data = JSON.parse(stdout)
        const devicesMap = data.devices || {}
        const out: DeviceInfo[] = []
        const checks: Promise<void>[] = []

        for (const runtime in devicesMap) {
          const devices = devicesMap[runtime]
          if (Array.isArray(devices)) {
            for (const device of devices) {
              const info: any = {
                platform: 'ios',
                id: device.udid,
                osVersion: parseRuntimeName(runtime),
                model: device.name,
                simulator: true
              }

              if (appId) {
                // check if installed
                const p = execCommand(['simctl', 'get_app_container', device.udid, appId, 'data'], device.udid)
                  .then(() => { info.appInstalled = true })
                  .catch(() => { info.appInstalled = false })
                  .then(() => { out.push(info) })
                checks.push(p)
              } else {
                out.push(info)
              }
            }
          }
        }

        Promise.all(checks).then(() => resolve(out)).catch(() => resolve(out))
      } catch (e) {
        resolve([])
      }
    })
  })
}

// --- iOS live log stream support ---
import { createWriteStream, promises as fsPromises } from 'fs'
import path from 'path'
import { parseLogLine } from '../android/utils.js'

const iosActiveLogStreams: Map<string, { proc: ReturnType<typeof import('child_process').spawn>, file: string }> = new Map()

// Test helpers
export function _setIOSActiveLogStream(sessionId: string, file: string) {
  iosActiveLogStreams.set(sessionId, { proc: {} as any, file })
}

export function _clearIOSActiveLogStream(sessionId: string) {
  iosActiveLogStreams.delete(sessionId)
}

export async function startIOSLogStream(bundleId: string, level: 'error' | 'warn' | 'info' | 'debug' = 'error', deviceId: string = 'booted', sessionId: string = 'default') : Promise<{ success: boolean; stream_started?: boolean; error?: string }> {
  try {
    // Build predicate to filter by process or subsystem
    const predicate = `process == "${bundleId}" or subsystem contains "${bundleId}"`

    // Prevent multiple streams per session
    if (iosActiveLogStreams.has(sessionId)) {
      try { iosActiveLogStreams.get(sessionId)!.proc.kill() } catch (e) {}
      iosActiveLogStreams.delete(sessionId)
    }

    // Start simctl log stream: xcrun simctl spawn <device> log stream --style syslog --predicate '<predicate>'
    const args = ['simctl', 'spawn', deviceId, 'log', 'stream', '--style', 'syslog', '--predicate', predicate]
    const proc = spawn(XCRUN, args)

    // Prepare output file
    const tmpDir = process.env.TMPDIR || '/tmp'
    const file = path.join(tmpDir, `mobile-debug-ios-log-${sessionId}.ndjson`)
    const stream = createWriteStream(file, { flags: 'a' })

    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString()
      const lines = text.split(/\r?\n/).filter(Boolean)
      for (const l of lines) {
        // Try to parse with shared parser; parser may be optimized for Android but extracts exceptions and message
        const entry = parseLogLine(l)
        stream.write(JSON.stringify(entry) + '\n')
      }
    })

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      const lines = text.split(/\r?\n/).filter(Boolean)
      for (const l of lines) {
        const entry = { timestamp: '', level: 'E', tag: 'xcrun', message: l }
        stream.write(JSON.stringify(entry) + '\n')
      }
    })

    proc.on('close', (code) => {
      stream.end()
      iosActiveLogStreams.delete(sessionId)
    })

    iosActiveLogStreams.set(sessionId, { proc, file })
    return { success: true, stream_started: true }
  } catch (err) {
    return { success: false, error: 'log_stream_start_failed' }
  }
}

export async function stopIOSLogStream(sessionId: string = 'default'): Promise<{ success: boolean }> {
  const entry = iosActiveLogStreams.get(sessionId)
  if (!entry) return { success: true }
  try { entry.proc.kill() } catch (e) {}
  iosActiveLogStreams.delete(sessionId)
  return { success: true }
}

export async function readIOSLogStreamLines(sessionId: string = 'default', limit: number = 100, since?: string): Promise<{ entries: any[], crash_summary?: { crash_detected: boolean, exception?: string, sample?: string } }> {
  const entry = iosActiveLogStreams.get(sessionId)
  if (!entry) return { entries: [] }
  try {
    const data = await fsPromises.readFile(entry.file, 'utf8').catch(() => '')
    if (!data) return { entries: [], crash_summary: { crash_detected: false } }
    const lines = data.split(/\r?\n/).filter(Boolean)
    const parsed = lines.map(l => {
      try {
        return JSON.parse(l)
      } catch {
        return { message: l, _iso: null, crash: false }
      }
    })

    // Minimal since filtering if provided
    let filtered = parsed
    if (since) {
      let sinceMs: number | null = null
      if (/^\d+$/.test(since)) sinceMs = Number(since)
      else {
        const sDate = new Date(since)
        if (!isNaN(sDate.getTime())) sinceMs = sDate.getTime()
      }
      if (sinceMs !== null) {
        filtered = parsed.filter(p => p._iso && (new Date(p._iso).getTime() >= sinceMs))
      }
    }

    const entries = filtered.slice(-Math.max(0, limit))
    const crashEntry = entries.find(e => e.crash)
    const crash_summary = crashEntry ? { crash_detected: true, exception: crashEntry.exception, sample: crashEntry.message } : { crash_detected: false }
    return { entries, crash_summary }
  } catch (e) {
    return { entries: [], crash_summary: { crash_detected: false } }
  }
}
