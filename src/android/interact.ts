import { StartAppResponse, TerminateAppResponse, RestartAppResponse, ResetAppDataResponse, WaitForElementResponse, TapResponse, SwipeResponse, TypeTextResponse, PressBackResponse } from "../types.js"
import { execAdb, getAndroidDeviceMetadata, getDeviceInfo, spawnAdb } from "./utils.js"
import { detectJavaHome } from "../utils/java.js"
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

  async build(projectPath: string, _variant?: string): Promise<{ artifactPath: string, output?: string } | { error: string }> {
    void _variant
    // Attempt to build using gradlew/gradle and return first found APK
    try {
      const { prepareGradle } = await import('./utils.js').catch(() => ({ prepareGradle: undefined })) as any
      if (prepareGradle && typeof prepareGradle === 'function') {
        const { execCmd, gradleArgs, spawnOpts } = await prepareGradle(projectPath)
        await new Promise<void>((resolve, reject) => {
          const proc = spawn(execCmd, gradleArgs, spawnOpts)
          let stderr = ''
          proc.stderr?.on('data', d => stderr += d.toString())
          proc.on('close', code => {
            if (code === 0) resolve()
            else reject(new Error(stderr || `Gradle failed with code ${code}`))
          })
          proc.on('error', err => reject(err))
        })
      } else {
        const gradlewPath = path.join(projectPath, 'gradlew')
        const gradleCmd = existsSync(gradlewPath) ? './gradlew' : 'gradle'
        const execCmd = existsSync(gradlewPath) ? gradlewPath : gradleCmd
        const gradleArgs = ['assembleDebug']
        await new Promise<void>((resolve, reject) => {
          const proc = spawn(execCmd, gradleArgs, { cwd: projectPath, shell: existsSync(gradlewPath) ? false : true })
          let stderr = ''
          proc.stderr?.on('data', d => stderr += d.toString())
          proc.on('close', code => {
            if (code === 0) resolve()
            else reject(new Error(stderr || `Gradle failed with code ${code}`))
          })
          proc.on('error', err => reject(err))
        })
      }
      // Find built APK
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
      const apk = await findApk(projectPath)
      if (!apk) return { error: 'Could not find APK after build' }
      return { artifactPath: apk }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
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

        await new Promise<void>(async (resolve, reject) => {
          // Auto-detect and set JAVA_HOME (prefer JDK 17) so builds don't require manual environment setup
          const detectedJavaHome = await detectJavaHome().catch(() => undefined)
          const env = Object.assign({}, process.env)
          if (detectedJavaHome) {
            // Override existing JAVA_HOME if detection found a preferably compatible JDK (e.g., JDK 17).
            if (env.JAVA_HOME !== detectedJavaHome) {
              env.JAVA_HOME = detectedJavaHome
              // Also ensure the JDK bin is on PATH so tools like jlink/javac are resolved from the detected JDK
              env.PATH = `${path.join(detectedJavaHome, 'bin')}${path.delimiter}${env.PATH || ''}`
              console.debug('[android] Overriding JAVA_HOME with detected path:', detectedJavaHome)
            }
          }

          // Sanitize environment so user shell init scripts are less likely to override our JAVA_HOME.
          try {
            // Remove obvious shell profile hints; avoid touching SDKMAN symlinks or on-disk state.
            delete env.SHELL
          } catch {}

          // If we detected a compatible JDK, instruct Gradle to use it and avoid daemon reuse
          // Prepare gradle invocation
          const gradleArgs = ['assembleDebug']
          if (detectedJavaHome) {
            gradleArgs.push(`-Dorg.gradle.java.home=${detectedJavaHome}`)
            gradleArgs.push('--no-daemon')
            env.GRADLE_JAVA_HOME = detectedJavaHome
          }

          // Prefer invoking the wrapper directly without a shell to avoid user profile shims (sdkman) re-setting JAVA_HOME
          const wrapperPath = path.join(apkPath, 'gradlew')
          const useWrapper = existsSync(wrapperPath)
          const execCmd = useWrapper ? wrapperPath : gradleCmd
          const spawnOpts: any = { cwd: apkPath, env }
          // When using wrapper, ensure it's executable and invoke directly (no shell)
          if (useWrapper) {
            // Ensure the wrapper is executable; swallow errors from chmod (best-effort).
            await fs.chmod(wrapperPath, 0o755).catch(() => {})
            spawnOpts.shell = false
          } else {
            // if using system 'gradle' allow shell to resolve platform PATH
            spawnOpts.shell = true
          }

          const proc = spawn(execCmd, gradleArgs, spawnOpts)
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

      // Try normal adb install with streaming attempt
      try {
        const res = await spawnAdb(['install', '-r', apkToInstall], deviceId)
        if (res.code === 0) {
          return { device: deviceInfo, installed: true, output: res.stdout }
        }
        // fallthrough to fallback
      } catch (e) {
        // Log and continue to fallback
        console.debug('[android] adb install failed, attempting push+pm fallback:', e instanceof Error ? e.message : String(e))
      }

      // Fallback: push APK to device and use pm install -r
      const basename = path.basename(apkToInstall)
      const remotePath = `/data/local/tmp/${basename}`
      await execAdb(['push', apkToInstall, remotePath], deviceId)
      const pmOut = await execAdb(['shell', 'pm', 'install', '-r', remotePath], deviceId)
      // cleanup remote file
      try { await execAdb(['shell', 'rm', remotePath], deviceId) } catch {}
      return { device: deviceInfo, installed: true, output: pmOut }
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
