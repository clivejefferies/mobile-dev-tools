#!/usr/bin/env node
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

async function findAppInDerived(derivedPath: string): Promise<string | null> {
  const products = path.join(derivedPath, 'Build', 'Products')
  try {
    const entries = await fs.promises.readdir(products, { withFileTypes: true })
    for (const e of entries) {
      if (e.isDirectory() && e.name.includes('Debug-iphonesimulator')) {
        const full = path.join(products, e.name)
        const apps = await fs.promises.readdir(full, { withFileTypes: true })
        for (const a of apps) {
          if (a.isDirectory() && a.name.endsWith('.app')) return path.join(full, a.name)
        }
      }
    }
  } catch {
    return null
  }
  return null
}

function spawnStream(cmd: string, args: string[], opts: any = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts })
    child.stdout?.on('data', d => process.stdout.write(d))
    child.stderr?.on('data', d => process.stderr.write(d))
    child.on('close', code => resolve(code ?? 0))
    child.on('error', err => reject(err))
  })
}

async function main() {
  const [, , projectPath, deviceId = 'booted'] = process.argv
  if (!projectPath) {
    console.error('Usage: tsx test/integration/manage/run-build-install-ios.ts <project-dir> [deviceId]')
    process.exit(1)
  }

  const derived = `/tmp/derived_ios_integration_${Date.now()}`
  // detect workspace or project
  const files = await fs.promises.readdir(projectPath).catch(() => [])
  const workspace = files.find(f => f.endsWith('.xcworkspace'))
  const proj = files.find(f => f.endsWith('.xcodeproj'))
  if (!workspace && !proj) {
    console.error('No Xcode project/workspace found in', projectPath)
    process.exit(2)
  }

  const buildArgs = workspace
    ? ['-workspace', path.join(projectPath, workspace), '-scheme', workspace.replace(/\.xcworkspace$/, ''), '-configuration', 'Debug', '-sdk', 'iphonesimulator', '-derivedDataPath', derived, 'build']
    : ['-project', path.join(projectPath, proj!), '-scheme', proj!.replace(/\.xcodeproj$/, ''), '-configuration', 'Debug', '-sdk', 'iphonesimulator', '-derivedDataPath', derived, 'build']

  console.error('Building with xcodebuild... derivedDataPath=', derived)
  const code = await spawnStream('xcodebuild', buildArgs, { cwd: projectPath })
  if (code !== 0) {
    console.error('xcodebuild failed with code', code)
    process.exit(3)
  }

  const app = await findAppInDerived(derived)
  if (!app) {
    console.error('Could not find built .app in derived data')
    process.exit(4)
  }

  console.error('Built app at', app)

  console.error('Installing via simctl...')
  const installCode = await spawnStream('xcrun', ['simctl', 'install', deviceId, app])
  if (installCode !== 0) {
    console.error('simctl install failed with code', installCode)
    process.exit(5)
  }

  console.log(JSON.stringify({ success: true, app, deviceId }))
  process.exit(0)
}

main().catch(e => { console.error('Unexpected error', e); process.exit(10) })
