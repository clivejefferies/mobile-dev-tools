import { spawn } from 'child_process'
import { DeviceInfo, UIElement } from "../../types.js"
import { promises as fsPromises, existsSync } from 'fs'
import path from 'path'
import { detectJavaHome } from '../java.js'

export function getAdbCmd() { return process.env.ADB_PATH || 'adb' }

/**
 * Prepare Gradle execution options for building an Android project.
 * Returns execCmd (wrapper or gradle), base gradleArgs array, and spawn options including env.
 */
export async function prepareGradle(projectPath: string): Promise<{ execCmd: string, gradleArgs: string[], spawnOpts: any }> {
  const gradlewPath = path.join(projectPath, 'gradlew')
  const gradleCmd = existsSync(gradlewPath) ? './gradlew' : 'gradle'
  const execCmd = existsSync(gradlewPath) ? gradlewPath : gradleCmd

  // Start with a default task; callers may append/override via env flags
  const gradleArgs: string[] = [ process.env.MCP_GRADLE_TASK || 'assembleDebug' ]

  // Respect generic MCP_BUILD_JOBS and Android-specific MCP_GRADLE_WORKERS
  const workers = process.env.MCP_GRADLE_WORKERS || process.env.MCP_BUILD_JOBS
  if (workers) {
    gradleArgs.push(`--max-workers=${workers}`)
  }

  // Respect gradle cache env: default enabled; set MCP_GRADLE_CACHE=0 to disable
  if (process.env.MCP_GRADLE_CACHE === '0') {
    gradleArgs.push('-Dorg.gradle.caching=false')
  }

  const detectedJavaHome = await detectJavaHome().catch(() => undefined)
  const env = Object.assign({}, process.env)
  if (detectedJavaHome) {
    if (env.JAVA_HOME !== detectedJavaHome) {
      env.JAVA_HOME = detectedJavaHome
      env.PATH = `${path.join(detectedJavaHome, 'bin')}${path.delimiter}${env.PATH || ''}`
    }
    gradleArgs.push(`-Dorg.gradle.java.home=${detectedJavaHome}`)
    gradleArgs.push('--no-daemon')
    env.GRADLE_JAVA_HOME = detectedJavaHome
  }

  try { delete env.SHELL } catch {}

  const useWrapper = existsSync(gradlewPath)
  const spawnOpts: any = { cwd: projectPath, env }
  if (useWrapper) {
    try { await fsPromises.chmod(gradlewPath, 0o755) } catch {}
    spawnOpts.shell = false
  } else {
    spawnOpts.shell = true
  }

  return { execCmd, gradleArgs, spawnOpts }
}


// Helper to construct ADB args with optional device ID
function getAdbArgs(args: string[], deviceId?: string): string[] {
  if (deviceId) {
    return ['-s', deviceId, ...args]
  }
  return args
}

/**
 * Determine an effective ADB timeout (ms) prioritizing:
 * 1. provided customTimeout
 * 2. MCP_ADB_TIMEOUT or ADB_TIMEOUT env vars
 * 3. sensible per-command defaults
 */
function getAdbTimeout(args: string[], customTimeout?: number): number {
  if (typeof customTimeout === 'number' && !isNaN(customTimeout)) return customTimeout
  const envTimeout = parseInt(process.env.MCP_ADB_TIMEOUT || process.env.ADB_TIMEOUT || '', 10)
  if (!isNaN(envTimeout) && envTimeout > 0) return envTimeout
  if (args.includes('logcat')) return 10000
  if (args.includes('uiautomator') && args.includes('dump')) return 20000
  return 120000
}

import type { SpawnOptions } from 'child_process'

export type SpawnOptionsWithTimeout = SpawnOptions & { timeout?: number }

export function execAdb(args: string[], deviceId?: string, options: SpawnOptionsWithTimeout = {}): Promise<string> {
  const adbArgs = getAdbArgs(args, deviceId)
  return new Promise((resolve, reject) => {
    // Extract timeout from options if present, otherwise pass options to spawn
    const { timeout: customTimeout, ...spawnOptions } = options;
    
    // Use spawn instead of execFile for better stream control and to avoid potential buffering hangs
    const child = spawn(getAdbCmd(), adbArgs, spawnOptions)
    
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

    const timeoutMs = getAdbTimeout(args, customTimeout)


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

// Spawn adb but return full streams and exit code so callers can implement fallbacks or stream output
export function spawnAdb(args: string[], deviceId?: string, options: SpawnOptionsWithTimeout = {}): Promise<{ stdout: string, stderr: string, code: number | null }> {
  const adbArgs = getAdbArgs(args, deviceId)
  return new Promise((resolve, reject) => {
    const { timeout: customTimeout, ...spawnOptions } = options
    const child = spawn(getAdbCmd(), adbArgs, spawnOptions)

    let stdout = ''
    let stderr = ''

    if (child.stdout) child.stdout.on('data', d => { stdout += d.toString() })
    if (child.stderr) child.stderr.on('data', d => { stderr += d.toString() })

    const timeoutMs = getAdbTimeout(args, customTimeout)


    const timeout = setTimeout(() => {
      try { child.kill() } catch {}
      reject(new Error(`ADB command timed out after ${timeoutMs}ms: ${args.join(' ')}`))
    }, timeoutMs)

    child.on('close', (code) => {
      clearTimeout(timeout)
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code })
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
      } catch {
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
  } catch {
    return { platform: 'android', id: deviceId || 'default', osVersion: '', model: '', simulator: false }
  }
}

export async function findApk(dir: string): Promise<string | undefined> {
  const entries = await fsPromises.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      const found = await findApk(full)
      if (found) return found
    } else if (e.isFile() && full.endsWith('.apk')) {
      return full
    }
  }
  return undefined
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
  } catch {
    return []
  }
}

// UI helper utilities shared by observe/interact
export const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function parseBounds(bounds: string): [number, number, number, number] {
  const match = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (match) {
    return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3]), parseInt(match[4])];
  }
  return [0, 0, 0, 0];
}

export function getCenter(bounds: [number, number, number, number]): [number, number] {
  const [x1, y1, x2, y2] = bounds;
  return [Math.floor((x1 + x2) / 2), Math.floor((y1 + y2) / 2)];
}

export async function getScreenResolution(deviceId?: string): Promise<{ width: number; height: number }> {
  try {
    const output = await execAdb(['shell', 'wm', 'size'], deviceId);
    const match = output.match(/Physical size: (\d+)x(\d+)/);
    if (match) {
      return { width: parseInt(match[1]), height: parseInt(match[2]) };
    }
  } catch {
    // ignore
  }
  return { width: 0, height: 0 };
}

export function traverseNode(node: any, elements: UIElement[], parentIndex: number = -1, depth: number = 0): number {
  if (!node) return -1;

  let currentIndex = -1;

  if (node['@_class']) {
    const text = node['@_text'] || null;
    const contentDescription = node['@_content-desc'] || null;
    const clickable = node['@_clickable'] === 'true';
    const bounds = parseBounds(node['@_bounds'] || '[0,0][0,0]');

    const isUseful = clickable || (text && text.length > 0) || (contentDescription && contentDescription.length > 0);

    if (isUseful) {
      const element: UIElement = {
        text,
        contentDescription,
        type: node['@_class'] || 'unknown',
        resourceId: node['@_resource-id'] || null,
        clickable,
        enabled: node['@_enabled'] === 'true',
        visible: true,
        bounds,
        center: getCenter(bounds),
        depth
      };

      if (parentIndex !== -1) {
        element.parentId = parentIndex;
      }

      elements.push(element);
      currentIndex = elements.length - 1;
    }
  }

  const nextParentIndex = currentIndex !== -1 ? currentIndex : parentIndex;
  const nextDepth = currentIndex !== -1 ? depth + 1 : depth;

  const childrenIndices: number[] = [];

  if (node.node) {
    if (Array.isArray(node.node)) {
      node.node.forEach((child: any) => {
        const childIndex = traverseNode(child, elements, nextParentIndex, nextDepth);
        if (childIndex !== -1) childrenIndices.push(childIndex);
      });
    } else {
      const childIndex = traverseNode(node.node, elements, nextParentIndex, nextDepth);
      if (childIndex !== -1) childrenIndices.push(childIndex);
    }
  }

  if (currentIndex !== -1 && childrenIndices.length > 0) {
    elements[currentIndex].children = childrenIndices;
  }

  return currentIndex;
}

// Log stream management (one stream per session)

// (Legacy active stream map removed from utils during refactor; Observe modules manage their own active streams.)

// Robust log line parser supporting multiple logcat formats
export function parseLogLine(line: string) {  // Collapse internal newlines so multiline stack traces are parseable as a single entry
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

// Legacy readLogStreamLines shim removed. Use AndroidObserve.readLogStream(sessionId, limit, since) instead.

