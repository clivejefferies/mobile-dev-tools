import { promises as fs } from "fs"
import { spawn } from "child_process"
import { StartAppResponse, TerminateAppResponse, RestartAppResponse, ResetAppDataResponse, InstallAppResponse } from "../types.js"
import { execCommand, execCommandWithDiagnostics, getIOSDeviceMetadata, validateBundleId, getIdbCmd, findAppBundle } from "./utils.js"
import path from "path"

export class iOSManage {
  async build(projectPath: string, _variant?: string): Promise<{ artifactPath: string, output?: string } | { error: string }> {
    void _variant
    try {
      // Look for an Xcode workspace or project at the provided path. If not present, scan subdirectories (limited depth)
      async function findProject(root: string, maxDepth = 3): Promise<{ dir: string, workspace?: string, proj?: string } | null> {
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

      const projectInfo = await findProject(projectPath, 3)
      if (!projectInfo) return { error: 'No Xcode project or workspace found' }
      const projectRootDir = projectInfo.dir || projectPath
      const workspace = projectInfo.workspace
      const proj = projectInfo.proj

      // Determine destination: prefer explicit env var, otherwise use booted simulator UDID
      let destinationUDID = process.env.MCP_XCODE_DESTINATION_UDID || process.env.MCP_XCODE_DESTINATION || ''
      if (!destinationUDID) {
        try {
          const meta = await getIOSDeviceMetadata('booted')
          if (meta && meta.id) destinationUDID = meta.id
        } catch {}
      }

      let buildArgs: string[]
      if (workspace) {
        const workspacePath = path.join(projectRootDir, workspace)
        const scheme = workspace.replace(/\.xcworkspace$/, '')
        buildArgs = ['-workspace', workspacePath, '-scheme', scheme, '-configuration', 'Debug', '-sdk', 'iphonesimulator', 'build']
      } else {
        const projectPathFull = path.join(projectRootDir, proj!)
        const scheme = proj!.replace(/\.xcodeproj$/, '')
        buildArgs = ['-project', projectPathFull, '-scheme', scheme, '-configuration', 'Debug', '-sdk', 'iphonesimulator', 'build']
      }

      // If we have a destination UDID, add an explicit destination to avoid xcodebuild picking an ambiguous target
      if (destinationUDID) {
        buildArgs.push('-destination', `platform=iOS Simulator,id=${destinationUDID}`)
      }

      // Add result bundle path for diagnostics
      const resultsDir = path.join(projectPath, 'build-results')
      // Remove any stale results to avoid xcodebuild complaining about existing result bundles
      await fs.rm(resultsDir, { recursive: true, force: true }).catch(() => {})
      await fs.mkdir(resultsDir, { recursive: true }).catch(() => {})
      // Skip specifying -resultBundlePath to avoid platform-specific collisions; rely on stdout/stderr logs


      const xcodeCmd = process.env.XCODEBUILD_PATH || 'xcodebuild'
      const XCODEBUILD_TIMEOUT = parseInt(process.env.MCP_XCODEBUILD_TIMEOUT || '', 10) || 180000 // default 3 minutes
      const MAX_RETRIES = parseInt(process.env.MCP_XCODEBUILD_RETRIES || '', 10) || 1

      const tries = MAX_RETRIES + 1
      let lastStdout = ''
      let lastStderr = ''
      let lastErr: any = null

      for (let attempt = 1; attempt <= tries; attempt++) {
        // Run xcodebuild with a watchdog
        const res = await new Promise<{ code: number | null, stdout: string, stderr: string, killedByWatchdog?: boolean }>((resolve) => {
          const proc = spawn(xcodeCmd, buildArgs, { cwd: projectPath })
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
        // Include diagnostics and result bundle path when available
        return { error: `xcodebuild failed: ${lastErr.message}. See build-results for logs.`, output: `stdout:\n${lastStdout}\nstderr:\n${lastStderr}` }
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
