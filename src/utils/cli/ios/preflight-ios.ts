#!/usr/bin/env node
import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { getIdbCmd, isIDBInstalled, commandWhich } from '../idb/idb-helper.js'

async function exists(p: string) {
  try { await fs.promises.access(p); return true } catch { return false }
}

async function findFirst(root: string, patterns: string[], maxDepth = 4): Promise<string | null> {
  const queue: Array<{dir:string, depth:number}> = [{dir: root, depth:0}]
  while (queue.length) {
    const {dir, depth} = queue.shift()!
    try {
      console.error('DEBUG findFirst: reading dir', dir, 'depth', depth)
      const ents: fs.Dirent[] = await fs.promises.readdir(dir, { withFileTypes: true })
      console.error('DEBUG findFirst: entries', ents.map(e=>e.name))
      for (const e of ents) {
        const full = path.join(dir, e.name)
        for (const p of patterns) {
          if (e.name.endsWith(p)) {
            console.error('DEBUG findFirst: matched', full)
            return full
          }
        }
        if (e.isDirectory() && depth < maxDepth) queue.push({dir: full, depth: depth+1})
      }
    } catch (err) {
      console.error('DEBUG findFirst: read failed for', dir, err)
      // ignore
    }
  }
  return null
}

function startCompanionIfNeeded(companionPath: string | null, udid: string | null) {
  if (!companionPath || !udid) return { started: false, error: 'missing companion or udid' }
  try {
    const child = spawn(companionPath, ['--udid', udid], { detached: true, stdio: 'ignore' })
    child.unref()
    return { started: true }
  } catch (e:any) {
    return { started: false, error: e.message }
  }
}

async function main() {
  const args = process.argv.slice(2)
  let projectArg: string | undefined
  let udid: string | undefined
  let startCompanion = false
  let kmpBuild: any = null
  for (let i=0;i<args.length;i++) {
    const a = args[i]
    if (a === '--project' && args[i+1]) { projectArg = args[i+1]; i++ }
    else if (a === '--udid' && args[i+1]) { udid = args[i+1]; i++ }
    else if (a === '--start-companion') startCompanion = true
    else if (!projectArg) projectArg = a
  }

  const cwd = process.cwd()
  const projectRoot = projectArg ? path.resolve(projectArg) : cwd

  // If user passed a direct .xcodeproj or .xcworkspace path, accept it as the projectFile
  let projectFile: string | null = null
  try {
    const stat = await fs.promises.stat(projectRoot)
    if (stat.isFile() && (projectRoot.endsWith('.xcodeproj') || projectRoot.endsWith('.xcworkspace'))) {
      projectFile = projectRoot
    }
  } catch {
    // ignore
  }

  // detect project if not a direct file
  if (!projectFile) {
    const projectFound = await exists(projectRoot)
    if (projectFound) {
      projectFile = await findFirst(projectRoot, ['.xcworkspace', '.xcodeproj'], 2)
    } else {
      // attempt to find under cwd
      projectFile = await findFirst(cwd, ['.xcworkspace', '.xcodeproj'], 3)
    }
  }

  // 2) KMP Shared.framework detection (search for *.framework named Shared.framework)
  let kmpFramework: string | null = null
  const projectSearchRoot = projectFile ? (fs.existsSync(projectFile) && fs.lstatSync(projectFile).isDirectory() ? projectFile : path.dirname(projectFile)) : cwd
  kmpFramework = await findFirst(projectSearchRoot, ['Shared.framework'], 5)
  if (!kmpFramework) kmpFramework = await findFirst(cwd, ['Shared.framework'], 6)

  // 3) idb detection
  const idbPath = getIdbCmd()
  const idbAvailable = idbPath ? isIDBInstalled() : false

  // 4) idb_companion
  const companionPath = commandWhich('idb_companion')
  const companionAvailable = !!companionPath

  const suggestions: string[] = []
  if (!projectFile) suggestions.push('Provide correct project path or ensure .xcodeproj/.xcworkspace exists in project dir')
  if (!kmpFramework) suggestions.push('Run KMP Gradle task to produce Shared.framework before xcodebuild (e.g., :shared:embedAndSignAppleFrameworkForXcode)')
  if (!idbAvailable) suggestions.push('Ensure idb is in PATH or set MCP_IDB_PATH / IDB_PATH')
  if (!companionAvailable) suggestions.push('Install idb_companion and ensure it is in PATH')

  const result: any = {
    ok: !!projectFile && !!idbAvailable,
    project: {
      root: projectRoot,
      found: !!projectFile,
      projectFile: projectFile
    },
    kmp: {
      found: !!kmpFramework,
      path: kmpFramework,
      build: kmpBuild
    },
    idb: {
      cmd: idbPath,
      installed: idbAvailable
    },
    idb_companion: {
      cmd: companionPath,
      installed: companionAvailable
    },
    suggestions
  }

  if (startCompanion && udid) {
    const started = startCompanionIfNeeded(companionPath, udid)
    result.idb_companion.start = started
    if (started.started) result.ok = result.ok && true
  }

  console.log(JSON.stringify(result, null, 2))
  process.exit(result.ok ? 0 : 2)
}

main().catch(e => {
  // Report structured error on stdout (avoid noisy stderr in normal runs)
  console.log(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }, null, 2))
  process.exit(2)
})
