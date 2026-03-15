import { promises as fs } from "fs"
import { spawn } from "child_process"
import { StartAppResponse, TerminateAppResponse, RestartAppResponse, ResetAppDataResponse, WaitForElementResponse, TapResponse } from "../types.js"
import { execCommand, getIOSDeviceMetadata, validateBundleId, IDB } from "./utils.js"
import { iOSObserve } from "./observe.js"
import path from "path"

export class iOSInteract {
  private observe = new iOSObserve();

  async waitForElement(text: string, timeout: number, deviceId: string = "booted"): Promise<WaitForElementResponse> {
    const device = await getIOSDeviceMetadata(deviceId);
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      try {
        const tree = await this.observe.getUITree(deviceId);
        
        if (tree.error) {
          return { device, found: false, error: tree.error };
        }

        const element = tree.elements.find(e => e.text === text);
        if (element) {
          return { device, found: true, element };
        }
      } catch (e) {
        // Ignore errors during polling and retry
        console.error("Error polling UI tree:", e);
      }

      const elapsed = Date.now() - startTime;
      const remaining = timeout - elapsed;
      if (remaining <= 0) break;
      
      await new Promise(resolve => setTimeout(resolve, Math.min(500, remaining)));
    }
    return { device, found: false };
  }

  async tap(x: number, y: number, deviceId: string = "booted"): Promise<TapResponse> {
    const device = await getIOSDeviceMetadata(deviceId)
    
    // Check for idb
    const child = spawn(IDB, ['--version']);
    const idbExists = await new Promise<boolean>((resolve) => {
      child.on('error', () => resolve(false));
      child.on('close', (code) => resolve(code === 0));
    });

    if (!idbExists) {
        return {
            device,
            success: false,
            x,
            y,
            error: "iOS tap requires 'idb' (iOS Device Bridge)."
        }
    }

    try {
      const targetUdid = (device.id && device.id !== 'booted') ? device.id : undefined;
      const args = ['ui', 'tap', x.toString(), y.toString()];
      if (targetUdid) {
        args.push('--udid', targetUdid);
      }

      await new Promise<void>((resolve, reject) => {
        const proc = spawn(IDB, args);
        let stderr = '';
        proc.stderr.on('data', d => stderr += d.toString());
        proc.on('close', code => {
            if (code === 0) resolve();
            else reject(new Error(`idb ui tap failed: ${stderr}`));
        });
        proc.on('error', err => reject(err));
      });

      return { device, success: true, x, y };
    } catch (e) {
      return { device, success: false, x, y, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async build(projectPath: string, _variant?: string): Promise<{ artifactPath: string, output?: string } | { error: string }> {
    void _variant
    try {
      async function findAppBundle(dir: string): Promise<string | undefined> {
        const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
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
        const proc = spawn('xcodebuild', buildArgs, { cwd: projectPath })
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

  async installApp(appPath: string, deviceId: string = "booted"): Promise<import("../types.js").InstallAppResponse> {
    const device = await getIOSDeviceMetadata(deviceId)

    // Helper to find .app bundles under a directory
    async function findAppBundle(dir: string): Promise<string | undefined> {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
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

    try {
      let toInstall = appPath

      const stat = await fs.stat(appPath).catch(() => null)
      if (stat && stat.isDirectory()) {
        // If the provided path is already an .app bundle, use it directly
        if (appPath.endsWith('.app')) {
          toInstall = appPath
        } else {
          // If directory already contains a .app, use it
          const found = await findAppBundle(appPath)
          if (found) {
            toInstall = found
          } else {
            // Attempt to locate an Xcode project and build for simulator
            const files = await fs.readdir(appPath).catch(() => [])
            // Prefer workspace when present (CocoaPods / multi-project setups)
            const workspace = files.find(f => f.endsWith('.xcworkspace'))
            const proj = files.find(f => f.endsWith('.xcodeproj'))
            if (!workspace && !proj) throw new Error('No .app bundle, .xcworkspace or .xcodeproj found in directory')

            let buildArgs: string[]
            let scheme: string
            if (workspace) {
              const workspacePath = path.join(appPath, workspace)
              scheme = workspace.replace(/\.xcworkspace$/, '')
              buildArgs = ['-workspace', workspacePath, '-scheme', scheme, '-configuration', 'Debug', '-sdk', 'iphonesimulator', 'build', '-quiet']
            } else {
              const projectPath = path.join(appPath, proj!)
              scheme = proj!.replace(/\.xcodeproj$/, '')
              buildArgs = ['-project', projectPath, '-scheme', scheme, '-configuration', 'Debug', '-sdk', 'iphonesimulator', 'build', '-quiet']
            }

            await new Promise<void>((resolve, reject) => {
              const proc = spawn('xcodebuild', buildArgs, { cwd: appPath })
              let stderr = ''
              proc.stderr?.on('data', d => stderr += d.toString())
              proc.on('close', code => {
                if (code === 0) resolve()
                else reject(new Error(stderr || `xcodebuild failed with code ${code}`))
              })
              proc.on('error', err => reject(err))
            })

            const built = await findAppBundle(appPath)
            if (!built) throw new Error('Could not locate built .app after xcodebuild')
            toInstall = built
          }
        }
      }

      // Try simulator install first
      try {
        const res = await execCommand(['simctl', 'install', deviceId, toInstall], deviceId)
        return { device, installed: true, output: res.output }
      } catch (e) {
        // If simctl fails and idb is available, try idb install for physical devices
        try {
          const child = spawn(IDB, ['--version'])
          const idbExists = await new Promise<boolean>((resolve) => {
            child.on('error', () => resolve(false));
            child.on('close', (code) => resolve(code === 0));
          });
          if (idbExists) {
            // Use idb to install (works for physical devices and simulators)
            await new Promise<void>((resolve, reject) => {
              const proc = spawn(IDB, ['install', toInstall, '--udid', device.id]);
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
        } catch {
          // fallthrough
        }

        return { device, installed: false, error: e instanceof Error ? e.message : String(e) }
      }
    } catch (e) {
      return { device, installed: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  async startApp(bundleId: string, deviceId: string = "booted"): Promise<StartAppResponse> {
    validateBundleId(bundleId)
    const result = await execCommand(['simctl', 'launch', deviceId, bundleId], deviceId)
    const device = await getIOSDeviceMetadata(deviceId)
    // Simulate launch time and appStarted for demonstration
    return {
      device,
      appStarted: !!result.output,
      launchTimeMs: 1000,
    }
  }

  async terminateApp(bundleId: string, deviceId: string = "booted"): Promise<TerminateAppResponse> {
    validateBundleId(bundleId)
    await execCommand(['simctl', 'terminate', deviceId, bundleId], deviceId)
    const device = await getIOSDeviceMetadata(deviceId)
    return {
      device,
      appTerminated: true
    }
  }

  async restartApp(bundleId: string, deviceId: string = "booted"): Promise<RestartAppResponse> {
    // terminateApp already validates bundleId
    await this.terminateApp(bundleId, deviceId)
    const startResult = await this.startApp(bundleId, deviceId)
    return {
      device: startResult.device,
      appRestarted: startResult.appStarted,
      launchTimeMs: startResult.launchTimeMs
    }
  }

  async resetAppData(bundleId: string, deviceId: string = "booted"): Promise<ResetAppDataResponse> {
    validateBundleId(bundleId)
    await this.terminateApp(bundleId, deviceId)
    const device = await getIOSDeviceMetadata(deviceId)
    
    // Get data container path
    const containerResult = await execCommand(['simctl', 'get_app_container', deviceId, bundleId, 'data'], deviceId)
    const dataPath = containerResult.output.trim()
    
    if (!dataPath) {
      throw new Error(`Could not find data container for ${bundleId}`)
    }

    // Clear contents of Library and Documents
    try {
      const libraryPath = `${dataPath}/Library`
      const documentsPath = `${dataPath}/Documents`
      const tmpPath = `${dataPath}/tmp`
      
      await fs.rm(libraryPath, { recursive: true, force: true }).catch(() => {})
      await fs.rm(documentsPath, { recursive: true, force: true }).catch(() => {})
      await fs.rm(tmpPath, { recursive: true, force: true }).catch(() => {})

      // Re-create empty directories as they are expected by apps
      await fs.mkdir(libraryPath, { recursive: true }).catch(() => {})
      await fs.mkdir(documentsPath, { recursive: true }).catch(() => {})
      await fs.mkdir(tmpPath, { recursive: true }).catch(() => {})
      
      return {
        device,
        dataCleared: true
      }
    } catch (e) {
      throw new Error(`Failed to clear data for ${bundleId}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}
