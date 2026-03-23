import { execFile, spawn, execSync, spawnSync } from "child_process"
import { DeviceInfo } from "../../types.js"
import { promises as fsPromises } from 'fs'
import path from 'path'
import { makeEnvSnapshot } from '../diagnostics.js'

export function getXcrunCmd() { return process.env.XCRUN_PATH || 'xcrun' }

export function getConfiguredIdbPath(): string | undefined {
  if (process.env.MCP_IDB_PATH) return process.env.MCP_IDB_PATH
  if (process.env.IDB_PATH) return process.env.IDB_PATH
  const cfgPaths = [
    process.env.MCP_CONFIG_PATH || (process.env.HOME ? `${process.env.HOME}/.mcp/config.json` : ''),
    `${process.cwd()}/mcp.config.json`
  ]
  try {
    const fs = require('fs')
    for (const p of cfgPaths) {
      if (!p) continue
      try {
        if (fs.existsSync(p)) {
          const raw = fs.readFileSync(p, 'utf8')
          const json = JSON.parse(raw)
          if (json) {
            if (json.idbPath) return json.idbPath
            if (json.IDB_PATH) return json.IDB_PATH
          }
        }
      } catch {}
    }
  } catch {}
  return undefined
}

export function getIdbCmd() {
  const cfg = getConfiguredIdbPath()
  if (cfg) return cfg
  if (process.env.IDB_PATH) return process.env.IDB_PATH
  try {
    const p = execSync('which idb', { stdio: ['ignore','pipe','ignore'] }).toString().trim()
    if (p) return p
  } catch {}
  try {
    const p2 = execSync('command -v idb', { stdio: ['ignore','pipe','ignore'] }).toString().trim()
    if (p2) return p2
  } catch {}
  // check common user locations
  const common = [
    `${process.env.HOME}/Library/Python/3.9/bin/idb`,
    `${process.env.HOME}/Library/Python/3.10/bin/idb`,
    '/opt/homebrew/bin/idb',
    '/usr/local/bin/idb',
  ]
  for (const c of common) {
    try { execSync(`test -x ${c}`, { stdio: ['ignore','pipe','ignore'] }); return c } catch {}
  }
  return 'idb'
}

export async function isIDBInstalled(): Promise<boolean> {
  const cmd = getIdbCmd()
  try {
    execSync(`command -v ${cmd}`, { stdio: ['ignore','pipe','ignore'] })
    return true
  } catch {
    try {
      execSync(`${cmd} list-targets --json`, { stdio: ['ignore','pipe','ignore'], timeout: 2000 })
      return true
    } catch {
      return false
    }
  }
}

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
    const child = spawn(getXcrunCmd(), args)
    
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

    const DEFAULT_XCRUN_LOG_TIMEOUT = parseInt(process.env.MCP_XCRUN_LOG_TIMEOUT || '', 10) || 30000 // env (ms) or default 30s
  const DEFAULT_XCRUN_CMD_TIMEOUT = parseInt(process.env.MCP_XCRUN_TIMEOUT || '', 10) || 60000 // env (ms) or default 60s
  const timeoutMs = args.includes('log') ? DEFAULT_XCRUN_LOG_TIMEOUT : DEFAULT_XCRUN_CMD_TIMEOUT // choose appropriate timeout
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error(`Command timed out after ${timeoutMs}ms: ${getXcrunCmd()} ${args.join(' ')}`))
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

export function execCommandWithDiagnostics(args: string[], deviceId: string = "booted") {
  // Run synchronously to capture stdout/stderr and exitCode reliably for diagnostics
  const DEFAULT_XCRUN_LOG_TIMEOUT = parseInt(process.env.MCP_XCRUN_LOG_TIMEOUT || '', 10) || 30000
  const DEFAULT_XCRUN_CMD_TIMEOUT = parseInt(process.env.MCP_XCRUN_TIMEOUT || '', 10) || 60000
  const timeoutMs = args.includes('log') ? DEFAULT_XCRUN_LOG_TIMEOUT : DEFAULT_XCRUN_CMD_TIMEOUT
  const res = spawnSync(getXcrunCmd(), args, { encoding: 'utf8', timeout: timeoutMs }) as any
  const runResult = {
    exitCode: typeof res.status === 'number' ? res.status : null,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
    envSnapshot: makeEnvSnapshot(['PATH','IDB_PATH','JAVA_HOME','HOME']),
    command: getXcrunCmd(),
    args,
    deviceId
  }

  if (res.status !== 0) {
    // include suggested fixes for common errors
    const suggested: string[] = []
    if ((runResult.stderr || '').includes('xcodebuild: error')) {
      suggested.push('Ensure the project/workspace path is correct and xcodebuild is installed and accessible.')
    }
    if ((runResult.stderr || '').includes('No such file or directory') || (runResult.stderr || '').includes('not found')) {
      suggested.push('Check that Xcode Command Line Tools are installed and XCRUN_PATH is set if using non-standard location.')
    }

    // Return diagnostics object
    return { runResult: { ...runResult, suggestedFixes: suggested } }
  }

  return { runResult: { ...runResult, suggestedFixes: [] } }
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

export async function findAppBundle(dir: string): Promise<string | undefined> {
  const entries = await fsPromises.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (full.endsWith('.app')) return full
      const found = await findAppBundle(full)
      if (found) return found
    }
  }
  return undefined
}
export async function getIOSDeviceMetadata(deviceId: string = "booted"): Promise<DeviceInfo> {
  return new Promise((resolve) => {
    // If deviceId is provided (and not "booted"), attempt to find that device among booted simulators.
    execFile(getXcrunCmd(), ['simctl', 'list', 'devices', 'booted', '--json'], (err, stdout) => {
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
      } catch {
        resolve(fallback)
      }
    })
  })
}

export async function listIOSDevices(appId?: string): Promise<DeviceInfo[]> {
  return new Promise((resolve) => {
    // Query all devices and separately query booted devices to mark them
    execFile(getXcrunCmd(), ['simctl', 'list', 'devices', '--json'], (err, stdout) => {
      if (err || !stdout) return resolve([])
      try {
        const data = JSON.parse(stdout)
        const devicesMap = data.devices || {}
        const out: DeviceInfo[] = []
        const checks: Promise<void>[] = []

        // Get booted devices set
        execFile(getXcrunCmd(), ['simctl', 'list', 'devices', 'booted', '--json'], (err2, stdout2) => {
          const bootedSet = new Set<string>()
          if (!err2 && stdout2) {
            try {
              const bdata = JSON.parse(stdout2)
              const bmap = bdata.devices || {}
              for (const rt in bmap) {
                const devs = bmap[rt]
                if (Array.isArray(devs)) for (const d of devs) bootedSet.add(d.udid)
              }
            } catch {}
          }

          for (const runtime in devicesMap) {
            const devices = devicesMap[runtime]
            if (Array.isArray(devices)) {
              for (const device of devices) {
                const info: any = {
                  platform: 'ios',
                  id: device.udid,
                  osVersion: parseRuntimeName(runtime),
                  model: device.name,
                  simulator: true,
                  booted: bootedSet.has(device.udid)
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
        })
      } catch {
        resolve([])
      }
    })
  })
}
