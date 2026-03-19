import { execSync, spawnSync } from 'child_process'
import fs from 'fs'

export function getConfiguredIdbPath(): string | undefined {
  if (process.env.MCP_IDB_PATH) return process.env.MCP_IDB_PATH
  if (process.env.IDB_PATH) return process.env.IDB_PATH
  const cfgPaths = [
    process.env.MCP_CONFIG_PATH || (process.env.HOME ? `${process.env.HOME}/.mcp/config.json` : ''),
    `${process.cwd()}/mcp.config.json`
  ]
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
  return undefined
}

export function commandWhich(cmd: string): string | null {
  try {
    const r = spawnSync('command', ['-v', cmd], { stdio: ['ignore', 'pipe', 'ignore'] })
    if (r && r.status === 0 && r.stdout) return r.stdout.toString().trim()
  } catch {}
  try {
    const p = execSync(`which ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    if (p) return p
  } catch {}
  return null
}

export function getIdbCmd(): string | null {
  const cfg = getConfiguredIdbPath()
  if (cfg) return cfg
  if (process.env.IDB_PATH) return process.env.IDB_PATH

  // Prefer command -v/which
  const found = commandWhich('idb')
  if (found) return found

  // Common locations
  const common = [
    process.env.HOME ? `${process.env.HOME}/Library/Python/3.9/bin/idb` : '',
    process.env.HOME ? `${process.env.HOME}/Library/Python/3.10/bin/idb` : '',
    '/opt/homebrew/bin/idb',
    '/usr/local/bin/idb'
  ]
  for (const c of common) {
    if (!c) continue
    try { execSync(`test -x ${c}`, { stdio: ['ignore', 'pipe', 'ignore'] }); return c } catch {}
  }
  return null
}

export function isIDBInstalled(): boolean {
  const cmd = getIdbCmd()
  if (!cmd) return false
  try {
    // command -v <cmd>
    const r = spawnSync('command', ['-v', cmd], { stdio: ['ignore', 'pipe', 'ignore'] })
    if (r && r.status === 0) return true
  } catch {}
  try {
    execSync(`${cmd} list-targets --json`, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 })
    return true
  } catch {}
  return false
}
