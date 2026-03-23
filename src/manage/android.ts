import { promises as fs } from 'fs'
import { spawn } from 'child_process'
import path from 'path'
import { existsSync } from 'fs'
import { execAdb, spawnAdb, getAndroidDeviceMetadata, getDeviceInfo, findApk } from '../utils/android/utils.js'
import { execAdbWithDiagnostics } from '../utils/diagnostics.js'
import { detectJavaHome } from '../utils/java.js'
import { InstallAppResponse, StartAppResponse, TerminateAppResponse, RestartAppResponse, ResetAppDataResponse } from '../types.js'

export class AndroidManage {
  async build(projectPath: string, _variant?: string): Promise<{ artifactPath: string, output?: string } | { error: string }> {
    void _variant
    try {
      // Always use the shared prepareGradle utility for consistent env/setup
      const { execCmd, gradleArgs, spawnOpts } = await (await import('../utils/android/utils.js')).prepareGradle(projectPath)
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
    
      const apk = await findApk(projectPath)
      if (!apk) return { error: 'Could not find APK after build' }
      return { artifactPath: apk }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  }

  async installApp(apkPath: string, deviceId?: string): Promise<InstallAppResponse> {
    const metadata = await getAndroidDeviceMetadata('', deviceId)
    const deviceInfo = getDeviceInfo(deviceId || 'default', metadata)

    let apkToInstall: string = apkPath
    try {
      const stat = await fs.stat(apkPath).catch(() => null)
      if (stat && stat.isDirectory()) {
        const detectedJavaHome = await detectJavaHome().catch(() => undefined)
        const env = Object.assign({}, process.env)
        if (detectedJavaHome) {
          if (env.JAVA_HOME !== detectedJavaHome) {
            env.JAVA_HOME = detectedJavaHome
            env.PATH = `${path.join(detectedJavaHome, 'bin')}${path.delimiter}${env.PATH || ''}`
            console.debug('[android-run] Overriding JAVA_HOME with detected path:', detectedJavaHome)
          }
        }
        try { delete env.SHELL } catch {}

        const gradleArgs = ['assembleDebug']
        if (detectedJavaHome) {
          gradleArgs.push(`-Dorg.gradle.java.home=${detectedJavaHome}`)
          gradleArgs.push('--no-daemon')
          env.GRADLE_JAVA_HOME = detectedJavaHome
        }

        const wrapperPath = path.join(apkPath, 'gradlew')
        const useWrapper = existsSync(wrapperPath)
        const execCmd = useWrapper ? wrapperPath : 'gradle'
        const spawnOpts: any = { cwd: apkPath, env }
        if (useWrapper) {
          await fs.chmod(wrapperPath, 0o755).catch(() => {})
          spawnOpts.shell = false
        } else spawnOpts.shell = true

        const proc = spawn(execCmd, gradleArgs, spawnOpts)
        let stderr = ''
        await new Promise<void>((resolve, reject) => {
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

      try {
        const res = await spawnAdb(['install', '-r', apkToInstall], deviceId)
        if (res.code === 0) {
          return { device: deviceInfo, installed: true, output: res.stdout }
        }
      } catch (e) {
        console.debug('[android-run] adb install failed, attempting push+pm fallback:', e instanceof Error ? e.message : String(e))
      }

      const basename = path.basename(apkToInstall)
      const remotePath = `/data/local/tmp/${basename}`
      await execAdb(['push', apkToInstall, remotePath], deviceId)
      const pmOut = await execAdb(['shell', 'pm', 'install', '-r', remotePath], deviceId)
      try { await execAdb(['shell', 'rm', remotePath], deviceId) } catch {}
      return { device: deviceInfo, installed: true, output: pmOut }
    } catch (e) {
      // gather diagnostics for attempted adb operations
      const basename = path.basename(apkToInstall)
      const remotePath = `/data/local/tmp/${basename}`
      const installDiag = execAdbWithDiagnostics(['install', '-r', apkToInstall], deviceId)
      const pushDiag = execAdbWithDiagnostics(['push', apkToInstall, remotePath], deviceId)
      const pmDiag = execAdbWithDiagnostics(['shell', 'pm', 'install', '-r', remotePath], deviceId)
      return { device: deviceInfo, installed: false, error: e instanceof Error ? e.message : String(e), diagnostics: { installDiag, pushDiag, pmDiag } }
    }
  }

  async startApp(appId: string, deviceId?: string): Promise<StartAppResponse> {
    const metadata = await getAndroidDeviceMetadata(appId, deviceId)
    const deviceInfo = getDeviceInfo(deviceId || 'default', metadata)
    try {
      await execAdb(['shell', 'monkey', '-p', appId, '-c', 'android.intent.category.LAUNCHER', '1'], deviceId)
      return { device: deviceInfo, appStarted: true, launchTimeMs: 1000 }
    } catch (e:any) {
      const diag = execAdbWithDiagnostics(['shell', 'monkey', '-p', appId, '-c', 'android.intent.category.LAUNCHER', '1'], deviceId)
      return { device: deviceInfo, appStarted: false, launchTimeMs: 0, error: e instanceof Error ? e.message : String(e), diagnostics: diag }
    }
  }

  async terminateApp(appId: string, deviceId?: string): Promise<TerminateAppResponse> {
    const metadata = await getAndroidDeviceMetadata(appId, deviceId)
    const deviceInfo = getDeviceInfo(deviceId || 'default', metadata)
    try {
      await execAdb(['shell', 'am', 'force-stop', appId], deviceId)
      return { device: deviceInfo, appTerminated: true }
    } catch (e:any) {
      const diag = execAdbWithDiagnostics(['shell', 'am', 'force-stop', appId], deviceId)
      return { device: deviceInfo, appTerminated: false, error: e instanceof Error ? e.message : String(e), diagnostics: diag }
    }
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
    try {
      const output = await execAdb(['shell', 'pm', 'clear', appId], deviceId)
      return { device: deviceInfo, dataCleared: output === 'Success' }
    } catch (e:any) {
      const diag = execAdbWithDiagnostics(['shell', 'pm', 'clear', appId], deviceId)
      return { device: deviceInfo, dataCleared: false, error: e instanceof Error ? e.message : String(e), diagnostics: diag }
    }
  }
}
