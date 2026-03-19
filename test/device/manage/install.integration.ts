#!/usr/bin/env node
// Integration runner: calls existing run-install-android.ts or run-install-ios.ts
// Usage: npx tsx test/integration/install.integration.ts /path/to/project [deviceId]
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'

const args = process.argv.slice(2)
if (args.length < 1) {
  console.error('Usage: npx tsx test/integration/install.integration.ts /path/to/project [deviceId]')
  process.exit(2)
}
const project = args[0]
const deviceId = args[1]

function isAndroidDir(p: string) {
  try {
    const listing = fs.readdirSync(p)
    return listing.includes('gradlew') || listing.some((f: string) => f.endsWith('.gradle') || f === 'app' || f === 'settings.gradle')
  } catch { return false }
}

function isIosDir(p: string) {
  try {
    const listing = fs.readdirSync(p)
    return listing.some((f: string) => f.endsWith('.xcodeproj') || f.endsWith('.xcworkspace'))
  } catch { return false }
}

let runner: string | undefined
if (isAndroidDir(project)) {
  runner = path.join(process.cwd(), 'test', 'integration', 'run-install-android.ts')
} else if (isIosDir(project)) {
  runner = path.join(process.cwd(), 'test', 'integration', 'run-install-ios.ts')
} else {
  console.error('Cannot determine platform for project:', project)
  process.exit(3)
}

if (!runner) process.exit(4)

const proc = spawn('node', [runner, project, ...(deviceId ? [deviceId] : [])], { stdio: ['ignore', 'pipe', 'inherit'] })
let stdout = ''
proc.stdout?.on('data', (c) => { stdout += c.toString() })
proc.on('close', (code) => {
  if (code !== 0) {
    console.error('Runner failed with code', code)
    process.exit(code || 1)
  }
  try {
    const obj = JSON.parse(stdout)
    if (obj.installed) {
      console.log('Integration install succeeded')
      process.exit(0)
    } else {
      console.error('Integration reported not installed:', obj)
      process.exit(4)
    }
  } catch {
    console.error('Failed to parse runner output')
    console.error(stdout)
    process.exit(5)
  }
})
