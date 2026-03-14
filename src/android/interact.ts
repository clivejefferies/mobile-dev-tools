import { StartAppResponse, TerminateAppResponse, RestartAppResponse, ResetAppDataResponse, WaitForElementResponse, TapResponse, SwipeResponse, TypeTextResponse, PressBackResponse } from "../types.js"
import { execAdb, getAndroidDeviceMetadata, getDeviceInfo } from "./utils.js"
import { AndroidObserve } from "./observe.js"
import { promises as fs } from "fs"
import { spawn } from "child_process"
import path from "path"
import { existsSync } from "fs"

export class AndroidInteract {
  private observe = new AndroidObserve();

  async waitForElement(text: string, timeout: number, deviceId?: string): Promise<WaitForElementResponse> {
    const metadata = await getAndroidDeviceMetadata("", deviceId)
    const deviceInfo = getDeviceInfo(deviceId || 'default', metadata)
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      try {
        const tree = await this.observe.getUITree(deviceId);
        
        if (tree.error) {
          return { device: deviceInfo, found: false, error: tree.error };
        }

        const element = tree.elements.find(e => e.text === text);
        if (element) {
          return { device: deviceInfo, found: true, element };
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
    return { device: deviceInfo, found: false };
  }

  async tap(x: number, y: number, deviceId?: string): Promise<TapResponse> {
    const metadata = await getAndroidDeviceMetadata("", deviceId)
    const deviceInfo = getDeviceInfo(deviceId || 'default', metadata)

    try {
      await execAdb(['shell', 'input', 'tap', x.toString(), y.toString()], deviceId)
      return { device: deviceInfo, success: true, x, y }
    } catch (e) {
      return { device: deviceInfo, success: false, x, y, error: e instanceof Error ? e.message : String(e) }
    }
  }

  async swipe(x1: number, y1: number, x2: number, y2: number, duration: number, deviceId?: string): Promise<SwipeResponse> {
    const metadata = await getAndroidDeviceMetadata("", deviceId)
    const deviceInfo = getDeviceInfo(deviceId || 'default', metadata)

    try {
      await execAdb(['shell', 'input', 'swipe', x1.toString(), y1.toString(), x2.toString(), y2.toString(), duration.toString()], deviceId)
      return { device: deviceInfo, success: true, start: [x1, y1], end: [x2, y2], duration }
    } catch (e) {
      return { device: deviceInfo, success: false, start: [x1, y1], end: [x2, y2], duration, error: e instanceof Error ? e.message : String(e) }
    }
  }

  async typeText(text: string, deviceId?: string): Promise<TypeTextResponse> {
    const metadata = await getAndroidDeviceMetadata("", deviceId)
    const deviceInfo = getDeviceInfo(deviceId || 'default', metadata)

    try {
      // Encode spaces as %s to ensure proper input handling by adb shell input text
      const encodedText = text.replace(/\s/g, '%s')
      // Note: 'input text' might fail with some characters or if keyboard isn't ready, but it's the standard ADB way.
      await execAdb(['shell', 'input', 'text', encodedText], deviceId)
      return { device: deviceInfo, success: true, text }
    } catch (e) {
      return { device: deviceInfo, success: false, text, error: e instanceof Error ? e.message : String(e) }
    }
  }

  async pressBack(deviceId?: string): Promise<PressBackResponse> {
    const metadata = await getAndroidDeviceMetadata("", deviceId)
    const deviceInfo = getDeviceInfo(deviceId || 'default', metadata)

    try {
      await execAdb(['shell', 'input', 'keyevent', '4'], deviceId)
      return { device: deviceInfo, success: true }
    } catch (e) {
      return { device: deviceInfo, success: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  async installApp(apkPath: string, deviceId?: string): Promise<import("../types.js").InstallAppResponse> {
    const metadata = await getAndroidDeviceMetadata("", deviceId)
    const deviceInfo = getDeviceInfo(deviceId || 'default', metadata)

    // Helper to recursively find first APK under a directory
    async function findApk(dir: string): Promise<string | undefined> {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
      for (const e of entries) {
        const full = path.join(dir, e.name)
        if (e.isDirectory()) {
          const found = await findApk(full)
          if (found) return found
        } else if (e.isFile() && full.endsWith('.apk')) {
          return full
        }
      }
      return undefined
    }

    try {
      let apkToInstall = apkPath

      // If a directory is provided, attempt to build via Gradle
      const stat = await fs.stat(apkPath).catch(() => null)
      if (stat && stat.isDirectory()) {
        const gradlewPath = path.join(apkPath, 'gradlew')
        const gradleCmd = existsSync(gradlewPath) ? './gradlew' : 'gradle'

        await new Promise<void>((resolve, reject) => {
          const proc = spawn(gradleCmd, ['assembleDebug'], { cwd: apkPath, shell: true })
          let stderr = ''
          proc.stderr?.on('data', d => stderr += d.toString())
          proc.on('close', code => {
            if (code === 0) resolve()
            else reject(new Error(stderr || `Gradle build failed with code ${code}`))
          })
          proc.on('error', err => reject(err))
        })

        const built = await findApk(apkPath)
        if (!built) throw new Error('Could not locate built APK after running Gradle')
        apkToInstall = built
      }

      const output = await execAdb(['install', '-r', apkToInstall], deviceId)
      return { device: deviceInfo, installed: true, output }
    } catch (e) {
      return { device: deviceInfo, installed: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  async startApp(appId: string, deviceId?: string): Promise<StartAppResponse> {
    const metadata = await getAndroidDeviceMetadata(appId, deviceId)
    const deviceInfo = getDeviceInfo(deviceId || 'default', metadata)
    
    await execAdb(['shell', 'monkey', '-p', appId, '-c', 'android.intent.category.LAUNCHER', '1'], deviceId)
    
    return { device: deviceInfo, appStarted: true, launchTimeMs: 1000 }
  }

  async terminateApp(appId: string, deviceId?: string): Promise<TerminateAppResponse> {
    const metadata = await getAndroidDeviceMetadata(appId, deviceId)
    const deviceInfo = getDeviceInfo(deviceId || 'default', metadata)

    await execAdb(['shell', 'am', 'force-stop', appId], deviceId)
    
    return { device: deviceInfo, appTerminated: true }
  }

  async restartApp(appId: string, deviceId?: string): Promise<RestartAppResponse> {
    await this.terminateApp(appId, deviceId)
    const startResult = await this.startApp(appId, deviceId)
    return {
      device: startResult.device,
      appRestarted: startResult.appStarted,
      launchTimeMs: startResult.launchTimeMs
    }
  }

  async resetAppData(appId: string, deviceId?: string): Promise<ResetAppDataResponse> {
    const metadata = await getAndroidDeviceMetadata(appId, deviceId)
    const deviceInfo = getDeviceInfo(deviceId || 'default', metadata)

    const output = await execAdb(['shell', 'pm', 'clear', appId], deviceId)
    
    return { device: deviceInfo, dataCleared: output === 'Success' }
  }
}
