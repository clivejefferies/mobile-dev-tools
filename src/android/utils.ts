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
    // Extract timeout from options if present, otherwise pass options to spawn
    const { timeout: customTimeout, ...spawnOptions } = options;
    
    // Use spawn instead of execFile for better stream control and to avoid potential buffering hangs
    const child = spawn(ADB, adbArgs, spawnOptions)
    
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

    let timeoutMs = customTimeout || 2000;
    if (!customTimeout) {
      if (args.includes('logcat')) {
          timeoutMs = 10000;
      } else if (args.includes('uiautomator') && args.includes('dump')) {
          timeoutMs = 20000; // UI dump can be slow
      }
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
    // If no deviceId provided, try to auto-detect a single connected device
    let resolvedDeviceId = deviceId;
    if (!resolvedDeviceId) {
      try {
        const devicesOutput = await execAdb(['devices']);
        // Parse lines like: "<serial>\tdevice"
        const lines = devicesOutput.split('\n').map(l => l.trim()).filter(Boolean);
        const deviceLines = lines.slice(1) // skip header
          .map(l => l.split('\t'))
          .filter(parts => parts.length >= 2 && parts[1] === 'device')
          .map(parts => parts[0]);
        if (deviceLines.length === 1) {
          resolvedDeviceId = deviceLines[0];
        }
      } catch (e) {
        // ignore and continue without resolvedDeviceId
      }
    }

    // Run these in parallel to avoid sequential timeouts
    const [osVersion, model, simOutput] = await Promise.all([
      execAdb(['shell', 'getprop', 'ro.build.version.release'], resolvedDeviceId).catch(() => ''),
      execAdb(['shell', 'getprop', 'ro.product.model'], resolvedDeviceId).catch(() => ''),
      execAdb(['shell', 'getprop', 'ro.kernel.qemu'], resolvedDeviceId).catch(() => '0')
    ])
    
    const simulator = simOutput === '1'
    return { platform: 'android', id: resolvedDeviceId || 'default', osVersion, model, simulator }
  } catch (e) {
    return { platform: 'android', id: deviceId || 'default', osVersion: '', model: '', simulator: false }
  }
}

export async function listAndroidDevices(appId?: string): Promise<DeviceInfo[]> {
  try {
    const devicesOutput = await execAdb(['devices', '-l'])
    const lines = devicesOutput.split('\n').map(l => l.trim()).filter(Boolean)
    // Skip header if present (some adb versions include 'List of devices attached')
    const deviceLines = lines.filter(l => !l.startsWith('List of devices')).map(l => l)
    const serials = deviceLines.map(line => line.split(/\s+/)[0]).filter(Boolean)

    const infos = await Promise.all(serials.map(async (serial) => {
      try {
        const [osVersion, model, simOutput] = await Promise.all([
          execAdb(['shell', 'getprop', 'ro.build.version.release'], serial).catch(() => ''),
          execAdb(['shell', 'getprop', 'ro.product.model'], serial).catch(() => ''),
          execAdb(['shell', 'getprop', 'ro.kernel.qemu'], serial).catch(() => '0')
        ])
        const simulator = simOutput === '1'
        let appInstalled = false
        if (appId) {
          try {
            const pm = await execAdb(['shell', 'pm', 'path', appId], serial)
            appInstalled = !!(pm && pm.includes('package:'))
          } catch {
            appInstalled = false
          }
        }
        return { platform: 'android', id: serial, osVersion, model, simulator, appInstalled } as DeviceInfo & { appInstalled?: boolean }
      } catch {
        return { platform: 'android', id: serial, osVersion: '', model: '', simulator: false, appInstalled: false } as DeviceInfo & { appInstalled?: boolean }
      }
    }))

    return infos
  } catch (e) {
    return []
  }
}

// Log stream management (one stream per session)
import { createWriteStream, promises as fsPromises } from 'fs'
import path from 'path'

const activeLogStreams: Map<string, { proc: { kill: () => void } | ReturnType<typeof import('child_process').spawn>, file: string }> = new Map()

// Test helper to register a pre-existing NDJSON file as the active stream for a session (used by unit tests)
export function _setActiveLogStream(sessionId: string, file: string) {
  activeLogStreams.set(sessionId, { proc: { kill: () => {} }, file })
}

export function _clearActiveLogStream(sessionId: string) {
  activeLogStreams.delete(sessionId)
}

// Robust log line parser supporting multiple logcat formats
export function parseLogLine(line: string) {
  // Collapse internal newlines so multiline stack traces are parseable as a single entry
  const rawLine = line
  const normalizedLine = rawLine.replace(/\r?\n/g, ' ')
  const entry: any = { timestamp: '', level: '', tag: '', message: rawLine, _iso: null, crash: false }

  const nowYear = new Date().getFullYear()

  const tryIso = (ts: string) => {
    if (!ts) return null
    // If it's already ISO
    if (/^\d{4}-\d{2}-\d{2}T/.test(ts)) return ts
    // If format MM-DD HH:MM:SS(.sss)
    const m = ts.match(/^(\d{2})-(\d{2})\s+(\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)$/)
    if (m) {
      const month = m[1]
      const day = m[2]
      const time = m[3]
      const candidate = `${nowYear}-${month}-${day}T${time}`
      const d = new Date(candidate)
      if (!isNaN(d.getTime())) return d.toISOString()
    }
    // If format YYYY-MM-DD HH:MM:SS(.sss)
    const m2 = ts.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)$/)
    if (m2) {
      const candidate = `${m2[1]}T${m2[2]}`
      const d = new Date(candidate)
      if (!isNaN(d.getTime())) return d.toISOString()
    }
    return null
  }

  // Patterns to try (ordered)
  const patterns: Array<{re: RegExp, groups: string[]}> = [
    // MM-DD HH:MM:SS.mmm PID TID LEVEL/Tag: msg
    { re: /^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)\s+(\d+)\s+(\d+)\s+([VDIWE])\/([^:]+):\s*(.*)$/, groups: ['ts','pid','tid','level','tag','msg'] },
    // MM-DD HH:MM:SS.mmm PID TID LEVEL Tag: msg  (space between level and tag)
    { re: /^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)\s+(\d+)\s+(\d+)\s+([VDIWE])\s+([^:]+):\s*(.*)$/, groups: ['ts','pid','tid','level','tag','msg'] },
    // YYYY-MM-DD full date with PID TID LEVEL/Tag
    { re: /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)\s+(\d+)\s+(\d+)\s+([VDIWE])\/([^:]+):\s*(.*)$/, groups: ['ts','pid','tid','level','tag','msg'] },
    // YYYY-MM-DD with space separation
    { re: /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)\s+(\d+)\s+(\d+)\s+([VDIWE])\s+([^:]+):\s*(.*)$/, groups: ['ts','pid','tid','level','tag','msg'] },
    // MM-DD PID LEVEL/Tag: msg
    { re: /^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)\s+(\d+)\s+([VDIWE])\/([^:]+):\s*(.*)$/, groups: ['ts','pid','level','tag','msg'] },
    // MM-DD PID LEVEL Tag: msg (space)
    { re: /^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)\s+(\d+)\s+([VDIWE])\s+([^:]+):\s*(.*)$/, groups: ['ts','pid','level','tag','msg'] },
    // Short form LEVEL/Tag: msg
    { re: /^([VDIWE])\/([^\(\:]+)(?:\([0-9]+\))?:\s*(.*)$/, groups: ['level','tag','msg'] },
    // Short form LEVEL Tag: msg
    { re: /^([VDIWE])\s+([^\(\:]+)(?:\([0-9]+\))?:\s*(.*)$/, groups: ['level','tag','msg'] },
  ]

  for (const p of patterns) {
    const m = normalizedLine.match(p.re)
    if (m) {
      const g = p.groups
      const vals: any = {}
      for (let i=0;i<g.length;i++) vals[g[i]] = m[i+1]
      const ts = vals.ts
      if (ts) {
        const iso = tryIso(ts)
        if (iso) {
          entry.timestamp = ts
          entry._iso = iso
        } else {
          entry.timestamp = ts
        }
      }
      if (vals.level) entry.level = vals.level
      if (vals.tag) entry.tag = vals.tag.trim()
      entry.message = vals.msg || entry.message
      // Crash heuristics
      const msg = (entry.message || '').toString()
      const crash = /FATAL EXCEPTION/i.test(msg) || /\b([A-Za-z0-9_$.]+Exception)\b/.test(msg)
      if (crash) {
        entry.crash = true
        const exMatch = msg.match(/\b([A-Za-z0-9_$.]+Exception)\b/)
        if (exMatch) entry.exception = exMatch[1]
      }
      return entry
    }
  }

  // No pattern matched: attempt to extract level/tag like '... E/Tag: msg'
  const alt = normalizedLine.match(/([VDIWE])\/([^:]+):\s*(.*)$/)
  if (alt) {
    entry.level = alt[1]
    entry.tag = alt[2].trim()
    entry.message = alt[3]
    const msg = entry.message
    const crash = /FATAL EXCEPTION/i.test(msg) || /\b([A-Za-z0-9_$.]+Exception)\b/.test(msg)
    if (crash) {
      entry.crash = true
      const exMatch = msg.match(/\b([A-Za-z0-9_$.]+Exception)\b/)
      if (exMatch) entry.exception = exMatch[1]
    }
  }

  return entry
}

export async function startAndroidLogStream(packageName: string, level: 'error' | 'warn' | 'info' | 'debug' = 'error', deviceId?: string, sessionId: string = 'default'): Promise<{ success: boolean; stream_started?: boolean; error?: string }> {
  try {
    // Determine PID
    const pidOutput = await execAdb(['shell', 'pidof', packageName], deviceId).catch(() => '')
    const pid = (pidOutput || '').trim()
    if (!pid) {
      return { success: false, error: 'app_not_running' }
    }

    // Map level to logcat filter
    const levelMap: Record<string, string> = { error: '*:E', warn: '*:W', info: '*:I', debug: '*:D' }
    const filter = levelMap[level] || levelMap['error']

    // Prevent multiple streams per session
    if (activeLogStreams.has(sessionId)) {
      // stop existing
      try { activeLogStreams.get(sessionId)!.proc.kill() } catch(e) {}
      activeLogStreams.delete(sessionId)
    }

    // Start logcat process
    const args = ['logcat', `--pid=${pid}`, filter]
    const proc = spawn(ADB, args)

    // Prepare output file
    const tmpDir = process.env.TMPDIR || '/tmp'
    const file = path.join(tmpDir, `mobile-debug-log-${sessionId}.ndjson`)
    const stream = createWriteStream(file, { flags: 'a' })

    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString()
      const lines = text.split(/\r?\n/).filter(Boolean)
      for (const l of lines) {
        const entry = parseLogLine(l)
        stream.write(JSON.stringify(entry) + '\n')
      }
    })

    proc.stderr.on('data', (chunk) => {
      // write stderr lines as message with level 'E'
      const text = chunk.toString()
      const lines = text.split(/\r?\n/).filter(Boolean)
      for (const l of lines) {
        const entry = { timestamp: '', level: 'E', tag: 'adb', message: l }
        stream.write(JSON.stringify(entry) + '\n')
      }
    })

    proc.on('close', (code) => {
      stream.end()
      activeLogStreams.delete(sessionId)
    })

    activeLogStreams.set(sessionId, { proc, file })

    return { success: true, stream_started: true }
  } catch (err) {
    return { success: false, error: 'log_stream_start_failed' }
  }
}

export async function stopAndroidLogStream(sessionId: string = 'default'): Promise<{ success: boolean }> {
  const entry = activeLogStreams.get(sessionId)
  if (!entry) return { success: true }
  try {
    entry.proc.kill()
  } catch (e) {}
  activeLogStreams.delete(sessionId)
  return { success: true }
}

export async function readLogStreamLines(sessionId: string = 'default', limit: number = 100, since?: string): Promise<{ entries: any[], crash_summary?: { crash_detected: boolean, exception?: string, sample?: string } }> {
  const entry = activeLogStreams.get(sessionId)
  if (!entry) return { entries: [] }
  try {
    const data = await fsPromises.readFile(entry.file, 'utf8').catch(() => '')
    if (!data) return { entries: [], crash_summary: { crash_detected: false } }
    const lines = data.split(/\r?\n/).filter(Boolean)

    // Parse NDJSON lines into objects. Prefer fields written by parseLogLine. For backward compatibility, if _iso or crash are missing, enrich minimally here (avoid duplicating full parse logic).
    const parsed = lines.map(l => {
      try {
        const obj: any = JSON.parse(l)
        // Ensure _iso: if missing, try to derive using Date()
        if (typeof obj._iso === 'undefined') {
          let iso: string | null = null
          if (obj.timestamp) {
            const d = new Date(obj.timestamp)
            if (!isNaN(d.getTime())) iso = d.toISOString()
          }
          obj._iso = iso
        }
        // Ensure crash flag: if missing, run minimal heuristic
        if (typeof obj.crash === 'undefined') {
          const msg = (obj.message || '').toString()
          const exMatch = msg.match(/\b([A-Za-z0-9_$.]+Exception)\b/)
          if (/FATAL EXCEPTION/i.test(msg) || exMatch) {
            obj.crash = true
            if (exMatch) obj.exception = exMatch[1]
          } else {
            obj.crash = false
          }
        }
        return obj
      } catch {
        return { message: l, _iso: null, crash: false }
      }
    })

    // Filter by since if provided (accept ISO or epoch ms)
    let filtered = parsed
    if (since) {
      let sinceMs: number | null = null
      // If numeric string
      if (/^\d+$/.test(since)) sinceMs = Number(since)
      else {
        const sDate = new Date(since)
        if (!isNaN(sDate.getTime())) sinceMs = sDate.getTime()
      }
      if (sinceMs !== null) {
        filtered = parsed.filter(p => p._iso && (new Date(p._iso).getTime() >= sinceMs))
      }
    }

    // Return the last `limit` entries (most recent)
    const entries = filtered.slice(-Math.max(0, limit))

    // Crash summary
    const crashEntry = entries.find(e => e.crash)
    const crash_summary = crashEntry ? { crash_detected: true, exception: crashEntry.exception, sample: crashEntry.message } : { crash_detected: false }

    return { entries, crash_summary }
  } catch (e) {
    return { entries: [], crash_summary: { crash_detected: false } }
  }
}
