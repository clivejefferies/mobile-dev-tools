import { promises as fs } from "fs"
import { spawn } from "child_process"
import { StartAppResponse, TerminateAppResponse, RestartAppResponse, ResetAppDataResponse, InstallAppResponse } from "../types.js"
import { execCommand, execCommandWithDiagnostics, getIOSDeviceMetadata, validateBundleId, getIdbCmd, findAppBundle } from "./utils.js"
import path from "path"

export class iOSManage {
  async build(projectPath: string, _variant?: string): Promise<{ artifactPath: string, output?: string } | { error: string }> {
    void _variant
    try {
      const files = await fs.readdir(projectPath).catch(() => [])
      const workspace = files.find(f => f.endsWith('.xcworkspace'))
      const proj = files.find(f => f.endsWith('.xcodeproj'))
      if (!workspace && !proj) return { error: 'No Xcode project or workspace found' }

      let buildArgs: string[]
      if (workspace) {
        const workspacePath = path.join(projectPath, workspace)
        const scheme = workspace.replace(/\.xcworkspace$/, '')
        buildArgs = ['-workspace', workspacePath, '-scheme', scheme, '-configuration', 'Debug', '-sdk', 'iphonesimulator', 'build']
      } else {
        const projectPathFull = path.join(projectPath, proj!)
        const scheme = proj!.replace(/\.xcodeproj$/, '')
        buildArgs = ['-project', projectPathFull, '-scheme', scheme, '-configuration', 'Debug', '-sdk', 'iphonesimulator', 'build']
      }

      await new Promise<void>((resolve, reject) => {
        const xcodeCmd = process.env.XCODEBUILD_PATH || 'xcodebuild'
        const proc = spawn(xcodeCmd, buildArgs, { cwd: projectPath })
        let stderr = ''
        proc.stderr?.on('data', d => stderr += d.toString())
        proc.on('close', code => {
          if (code === 0) resolve()
          else reject(new Error(stderr || `xcodebuild failed with code ${code}`))
        })
        proc.on('error', err => reject(err))
      })

      const built = await findAppBundle(projectPath)
      if (!built) return { error: 'Could not find .app after build' }
      return { artifactPath: built }
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
