#!/usr/bin/env node
import { spawnSync } from 'child_process'
import readline from 'readline'
import { getIdbCmd, isIDBInstalled, commandWhich } from './idb-helper.js'

const IDB_PKG = 'fb-idb'

function runCommand(cmd: string, args: string[]): number {
  const res = spawnSync(cmd, args, { stdio: 'inherit' as any })
  return typeof res.status === 'number' ? res.status : 1
}

async function confirm(prompt: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(`${prompt} (y/N): `, (ans) => {
      rl.close()
      resolve(ans.trim().toLowerCase() === 'y')
    })
  })
}

async function main() {
  try {
    const idbFromEnv = process.env.IDB_PATH
    const existing = idbFromEnv || getIdbCmd()
    if (existing && isIDBInstalled()) {
      console.log('idb already available at:', existing)
      process.exit(0)
    }

    const auto = process.env.MCP_AUTO_INSTALL_IDB === 'true' || process.env.CI === 'true'

    if (!auto) {
      const ok = await confirm('idb not found. Attempt to install fb-idb now?')
      if (!ok) {
        console.log('Aborting install; set MCP_AUTO_INSTALL_IDB=true to auto-install in CI or non-interactive environments.')
        process.exit(2)
      }
    } else {
      console.log('Auto-install enabled (MCP_AUTO_INSTALL_IDB=true or CI=true)')
    }

    const attempts: { name: string; cmd: string; args: string[] }[] = []
    if (commandWhich('pipx')) attempts.push({ name: 'pipx', cmd: 'pipx', args: ['install', IDB_PKG] })
    if (commandWhich('pip') || commandWhich('python3')) attempts.push({ name: 'pip', cmd: commandWhich('pip') ? 'pip' : 'python3', args: commandWhich('pip') ? ['install', '--user', IDB_PKG] : ['-m', 'pip', 'install', '--user', IDB_PKG] })

    // Add brew as a fallback on macOS if present (best-effort)
    if (process.platform === 'darwin' && commandWhich('brew')) {
      attempts.push({ name: 'brew', cmd: 'brew', args: ['install', 'idb'] })
    }

    if (attempts.length === 0) {
      console.error('No installer tool (pipx/pip/brew) detected. Please install pipx or pip and re-run.')
      process.exit(2)
    }

    for (const a of attempts) {
      console.log(`Attempting install with ${a.name}: ${a.cmd} ${a.args.join(' ')}`)
      try {
        const code = runCommand(a.cmd, a.args)
        if (code !== 0) {
          console.warn(`${a.name} install exited with code ${code}`)
        }
      } catch (e) {
        console.warn(`${a.name} install failed: ${e instanceof Error ? e.message : String(e)}`)
      }

      const found = commandWhich('idb') || commandWhich('command -v idb')
      if (found) {
        console.log('idb installed at:', found)
        process.exit(0)
      }
    }

    console.error('idb was not installed by any installer tried. Please install fb-idb manually and re-run healthcheck.')
    process.exit(2)
  } catch (e) {
    console.error('Installer failed:', e instanceof Error ? e.message : String(e))
    process.exit(2)
  }
}

const scriptPath = new URL(import.meta.url).pathname;
if (scriptPath === process.argv[1]) {
  main().catch(e => { console.error('Installer failed:', e instanceof Error ? e.message : String(e)); process.exit(2); });
}

export { main }
