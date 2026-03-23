import { promises as fs } from "fs"
import { spawn, spawnSync } from "child_process"
import { StartAppResponse, TerminateAppResponse, RestartAppResponse, ResetAppDataResponse, InstallAppResponse } from "../types.js"
import { execCommand, execCommandWithDiagnostics, getIOSDeviceMetadata, validateBundleId, getIdbCmd, findAppBundle } from "../utils/ios/utils.js"
import path from "path"

export class iOSManage {
  async build(projectPath: string, optsOrVariant?: string | { workspace?: string, project?: string, scheme?: string, destinationUDID?: string, derivedDataPath?: string, forceClean?: boolean, xcodeCmd?: string }): Promise<{ artifactPath: string, output?: string } | { error: string, diagnostics?: any }> {
    // Support legacy variant string as second arg
    let opts: any = {}
    if (typeof optsOrVariant === 'string') opts.variant = optsOrVariant
    else opts = optsOrVariant || {}

    try {
      // Look for an Xcode workspace or project at the provided path. If not present, scan subdirectories (limited depth)
      async function findProject(root: string, maxDepth = 4): Promise<{ dir: string, workspace?: string, proj?: string } | null> {
        try {
          const ents = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
          for (const e of ents) {
            // .xcworkspace and .xcodeproj are directories on disk (bundles), not regular files
            if (e.name.endsWith('.xcworkspace')) return { dir: root, workspace: e.name }
            if (e.name.endsWith('.xcodeproj')) return { dir: root, proj: e.name }
          }
        } catch {}

        if (maxDepth <= 0) return null

        try {
          const ents = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
          for (const e of ents) {
            if (e.isDirectory()) {
              const candidate = await findProject(path.join(root, e.name), maxDepth - 1)
              if (candidate) return candidate
            }
          }
        } catch {}

        return null
      }

      // Resolve projectPath to an absolute path to avoid cwd-relative resolution issues
      const absProjectPath = path.resolve(projectPath)

      // If caller supplied explicit workspace/project, prefer those and set projectRootDir accordingly
      let projectRootDir = absProjectPath
      let workspace: string | undefined = opts.workspace
      let proj: string | undefined = opts.project

      if (workspace) {
        // normalize workspace path and set root to its parent
        workspace = path.isAbsolute(workspace) ? workspace : path.join(absProjectPath, workspace)
        projectRootDir = path.dirname(workspace)
        workspace = path.basename(workspace)
      } else if (proj) {
        proj = path.isAbsolute(proj) ? proj : path.join(absProjectPath, proj)
        projectRootDir = path.dirname(proj)
        proj = path.basename(proj)
      } else {
        const projectInfo = await findProject(absProjectPath, 4)
        if (!projectInfo) return { error: 'No Xcode project or workspace found' }
        projectRootDir = projectInfo.dir || absProjectPath
        workspace = projectInfo.workspace
        proj = projectInfo.proj
      }

      // Determine destination: prefer explicit option, then env var, otherwise use booted simulator UDID
      let destinationUDID = opts.destinationUDID || process.env.MCP_XCODE_DESTINATION_UDID || process.env.MCP_XCODE_DESTINATION || ''
      if (!destinationUDID) {
        try {
          const meta = await getIOSDeviceMetadata('booted')
          if (meta && meta.id) destinationUDID = meta.id
        } catch {}
      }

      // Determine xcode command early so it can be used when detecting schemes
      const xcodeCmd = opts.xcodeCmd || process.env.XCODEBUILD_PATH || 'xcodebuild'

      // Determine available schemes by querying xcodebuild -list rather than guessing
      async function detectScheme(xcodeCmdInner: string, workspacePath?: string, projectPathFull?: string, cwd?: string): Promise<string | null> {
        try {
          const args = workspacePath ? ['-list', '-workspace', workspacePath] : ['-list', '-project', projectPathFull!]
          // Run xcodebuild directly to list schemes
          const res = spawnSync(xcodeCmdInner, args, { cwd: cwd || projectRootDir, encoding: 'utf8', timeout: 20000 })
          const out = res.stdout || ''
          const schemesMatch = out.match(/Schemes:\s*\n([\s\S]*?)(?:\n\n|$)/m)
          if (schemesMatch) {
            const block = schemesMatch[1]
            const schemes = block.split(/\n/).map(s => s.trim()).filter(Boolean)
            if (schemes.length) return schemes[0]
          }
        } catch {}
        return null
      }

      // Prepare build flags and paths (support incremental builds)
      let buildArgs: string[]
      let chosenScheme: string | null = opts.scheme || null

      // Derived data and result bundle (agent-configurable)
      const derivedDataPath = opts.derivedDataPath || process.env.MCP_DERIVED_DATA || path.join(projectRootDir, 'build', 'DerivedData')
      // Use unique result bundle path by default to avoid collisions
      const resultBundlePath = process.env.MCP_XCODE_RESULTBUNDLE_PATH || path.join(projectRootDir, 'build', 'xcresults', `ResultBundle-${Date.now()}-${Math.random().toString(36).slice(2)}.xcresult`)
      const xcodeJobs = parseInt(process.env.MCP_XCODE_JOBS || '', 10) || 4
      const forceClean = opts.forceClean || process.env.MCP_FORCE_CLEAN === '1'

      // ensure result dirs exist
      await fs.mkdir(path.dirname(resultBundlePath), { recursive: true }).catch(() => {})
      await fs.mkdir(derivedDataPath, { recursive: true }).catch(() => {})
      // remove any pre-existing result bundle path to avoid xcodebuild complaining
      await fs.rm(resultBundlePath, { recursive: true, force: true }).catch(() => {})

      if (workspace) {
        const workspacePath = path.join(projectRootDir, workspace)
        if (!chosenScheme) chosenScheme = await detectScheme(xcodeCmd, workspacePath, undefined, projectRootDir)
        const scheme = chosenScheme || workspace.replace(/\.xcworkspace$/, '')
        buildArgs = ['-workspace', workspacePath, '-scheme', scheme, '-configuration', 'Debug', '-sdk', 'iphonesimulator', 'build']
      } else {
        const projectPathFull = path.join(projectRootDir, proj!)
        if (!chosenScheme) chosenScheme = await detectScheme(xcodeCmd, undefined, projectPathFull, projectRootDir)
        const scheme = chosenScheme || proj!.replace(/\.xcodeproj$/, '')
        buildArgs = ['-project', projectPathFull, '-scheme', scheme, '-configuration', 'Debug', '-sdk', 'iphonesimulator', 'build']
      }

      // Insert clean if explicitly requested via env or opts
      if (forceClean) {
        const idx = buildArgs.indexOf('build')
        if (idx >= 0) buildArgs.splice(idx, 0, 'clean')
      }

      // If we have a destination UDID, add an explicit destination to avoid xcodebuild picking an ambiguous target
      if (destinationUDID) {
        buildArgs.push('-destination', `platform=iOS Simulator,id=${destinationUDID}`)
      }

      // Add derived data and result bundle for diagnostics and faster incremental builds
      buildArgs.push('-derivedDataPath', derivedDataPath)
      buildArgs.push('-resultBundlePath', resultBundlePath)
      // parallelisation and jobs
      buildArgs.push('-parallelizeTargets')
      buildArgs.push('-jobs', String(xcodeJobs))

      // Prepare results directory for backwards-compatible logs
      const resultsDir = path.join(projectPath, 'build-results')
      // Remove any stale results to avoid xcodebuild complaining about existing result bundles
      await fs.rm(resultsDir, { recursive: true, force: true }).catch(() => {})
      await fs.mkdir(resultsDir, { recursive: true }).catch(() => {})


      const XCODEBUILD_TIMEOUT = parseInt(process.env.MCP_XCODEBUILD_TIMEOUT || '', 10) || 180000 // default 3 minutes
      const MAX_RETRIES = parseInt(process.env.MCP_XCODEBUILD_RETRIES || '', 10) || 1

      const tries = MAX_RETRIES + 1
      let lastStdout = ''
      let lastStderr = ''
      let lastErr: any = null

      for (let attempt = 1; attempt <= tries; attempt++) {
        // Run xcodebuild with a watchdog
        const res = await new Promise<{ code: number | null, stdout: string, stderr: string, killedByWatchdog?: boolean }>((resolve) => {
          const proc = spawn(xcodeCmd, buildArgs, { cwd: projectRootDir })
          let stdout = ''
          let stderr = ''

          proc.stdout?.on('data', d => stdout += d.toString())
          proc.stderr?.on('data', d => stderr += d.toString())

          let killed = false
          const to = setTimeout(() => {
            killed = true
            try { proc.kill('SIGKILL') } catch {}
          }, XCODEBUILD_TIMEOUT)

          proc.on('close', (code) => {
            clearTimeout(to)
            resolve({ code, stdout, stderr, killedByWatchdog: killed })
          })
          proc.on('error', (err) => {
            clearTimeout(to)
            resolve({ code: null, stdout, stderr: String(err), killedByWatchdog: killed })
          })
        })

        lastStdout = res.stdout
        lastStderr = res.stderr

        if (res.code === 0) {
          // success — clear any previous error and stop retrying
          lastErr = null
          break
        }

        // record the failure for reporting
        lastErr = new Error(res.stderr || `xcodebuild failed with code ${res.code}`)
        // Attach exit code and watchdog info so diagnostics can include them
        ;(lastErr as any).code = res.code
        ;(lastErr as any).exitCode = res.code
        ;(lastErr as any).killedByWatchdog = !!res.killedByWatchdog

        // write logs for diagnostics (helpful whether killed or not)
        try {
          await fs.writeFile(path.join(resultsDir, `xcodebuild-${attempt}.stdout.log`), res.stdout).catch(() => {})
          await fs.writeFile(path.join(resultsDir, `xcodebuild-${attempt}.stderr.log`), res.stderr).catch(() => {})
        } catch {}

        // If killed by watchdog and there are remaining attempts, continue to retry
        if (res.killedByWatchdog && attempt < tries) {
          continue
        }

        // no more retries or not a watchdog kill — break to report lastErr
        if (attempt >= tries) break
      }

      if (lastErr) {
        // Include diagnostics and result bundle path when available; provide structured info useful for agents
        const invokedCommand = `${xcodeCmd} ${buildArgs.map(a => a.includes(' ') ? `"${a}"` : a).join(' ')}`
        const envSnapshot = { PATH: process.env.PATH }
        return { error: `xcodebuild failed: ${lastErr.message}. See build-results for logs.`, output: `stdout:\n${lastStdout}\nstderr:\n${lastStderr}`, diagnostics: { exitCode: (lastErr as any).code || null, invokedCommand, cwd: projectRootDir, envSnapshot } }
      }

      // Try to locate built .app. First search project tree, then DerivedData if necessary
      const built = await findAppBundle(projectPath)
      if (built) return { artifactPath: built }

      // Fallback: search DerivedData for matching product
      const dd = path.join(process.env.HOME || '', 'Library', 'Developer', 'Xcode', 'DerivedData')
      try {
        const entries = await fs.readdir(dd).catch(() => [])
        for (const e of entries) {
          const candidate = path.join(dd, e)
          const found = await findAppBundle(candidate).catch(() => undefined)
          if (found) return { artifactPath: found }
        }
      } catch {}

      return { error: 'Could not find .app after build' }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  }

  async installApp(appPath: string, deviceId: string = "booted"): Promise<InstallAppResponse> {
    const device = await getIOSDeviceMetadata(deviceId)

    try {
      let toInstall = appPath

      const stat = await fs.stat(appPath).catch(() => null)
      if (stat && stat.isDirectory()) {
        if (appPath.endsWith('.app')) {
          toInstall = appPath
        } else {
          const found = await findAppBundle(appPath)
          if (found) {
            toInstall = found
          } else {
            // Reuse the existing build() implementation to avoid duplicating the xcodebuild logic
            const buildRes = await this.build(appPath)
            if ((buildRes as any).error) throw new Error((buildRes as any).error)
            toInstall = (buildRes as any).artifactPath
          }
        }
      }

      try {
          const res = await execCommand(['simctl', 'install', deviceId, toInstall], deviceId)
          return { device, installed: true, output: res.output }
        } catch (e) {
          // Gather diagnostics for simctl failure
          const diag = execCommandWithDiagnostics(['simctl', 'install', deviceId, toInstall], deviceId)
          try {
            const child = spawn(getIdbCmd(), ['--version'])
            const idbExists = await new Promise<boolean>((resolve) => {
              child.on('error', () => resolve(false));
              child.on('close', (code) => resolve(code === 0));
            });
            if (idbExists) {
              // attempt idb install via spawn but include diagnostics
              await new Promise<void>((resolve, reject) => {
                const proc = spawn(getIdbCmd(), ['install', toInstall, '--udid', device.id]);
                let stderr = '';
                proc.stderr.on('data', d => stderr += d.toString());
                proc.on('close', code => {
                  if (code === 0) resolve();
                  else reject(new Error(stderr || `idb install failed with code ${code}`));
                });
                proc.on('error', err => reject(err));
              });
              return { device, installed: true }
            }
          } catch {}
          return { device, installed: false, error: e instanceof Error ? e.message : String(e), diagnostics: diag }
        }
    } catch (e) {
      return { device, installed: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  async startApp(bundleId: string, deviceId: string = "booted"): Promise<StartAppResponse> {
    validateBundleId(bundleId)
    try {
      const result = await execCommand(['simctl', 'launch', deviceId, bundleId], deviceId)
      const device = await getIOSDeviceMetadata(deviceId)
      return { device, appStarted: !!result.output, launchTimeMs: 1000 }
    } catch (e:any) {
      const diag = execCommandWithDiagnostics(['simctl', 'launch', deviceId, bundleId], deviceId)
      const device = await getIOSDeviceMetadata(deviceId)
      return { device, appStarted: false, launchTimeMs: 0, error: e instanceof Error ? e.message : String(e), diagnostics: diag } as any
    }
  }

  async terminateApp(bundleId: string, deviceId: string = "booted"): Promise<TerminateAppResponse> {
    validateBundleId(bundleId)
    try {
      await execCommand(['simctl', 'terminate', deviceId, bundleId], deviceId)
      const device = await getIOSDeviceMetadata(deviceId)
      return { device, appTerminated: true }
    } catch (e:any) {
      const diag = execCommandWithDiagnostics(['simctl', 'terminate', deviceId, bundleId], deviceId)
      const device = await getIOSDeviceMetadata(deviceId)
      return { device, appTerminated: false, error: e instanceof Error ? e.message : String(e), diagnostics: diag } as any
    }
  }

  async restartApp(bundleId: string, deviceId: string = "booted"): Promise<RestartAppResponse> {
    await this.terminateApp(bundleId, deviceId)
    const startResult = await this.startApp(bundleId, deviceId)
    return { device: startResult.device, appRestarted: startResult.appStarted, launchTimeMs: startResult.launchTimeMs }
  }

  async resetAppData(bundleId: string, deviceId: string = "booted"): Promise<ResetAppDataResponse> {
    validateBundleId(bundleId)
    await this.terminateApp(bundleId, deviceId)
    const device = await getIOSDeviceMetadata(deviceId)
    try {
      const containerResult = await execCommand(['simctl', 'get_app_container', deviceId, bundleId, 'data'], deviceId)
      const dataPath = containerResult.output.trim()
      if (!dataPath) throw new Error(`Could not find data container for ${bundleId}`)

      try {
        const libraryPath = `${dataPath}/Library`
        const documentsPath = `${dataPath}/Documents`
        const tmpPath = `${dataPath}/tmp`
        await fs.rm(libraryPath, { recursive: true, force: true }).catch(() => {})
        await fs.rm(documentsPath, { recursive: true, force: true }).catch(() => {})
        await fs.rm(tmpPath, { recursive: true, force: true }).catch(() => {})
        await fs.mkdir(libraryPath, { recursive: true }).catch(() => {})
        await fs.mkdir(documentsPath, { recursive: true }).catch(() => {})
        await fs.mkdir(tmpPath, { recursive: true }).catch(() => {})
        return { device, dataCleared: true }
      } catch (e) {
        throw new Error(`Failed to clear data for ${bundleId}: ${e instanceof Error ? e.message : String(e)}`)
      }
    } catch (e:any) {
      const diag = execCommandWithDiagnostics(['simctl', 'get_app_container', deviceId, bundleId, 'data'], deviceId)
      return { device, dataCleared: false, error: e instanceof Error ? e.message : String(e), diagnostics: diag } as any
    }
  }
}
