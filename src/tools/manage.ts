import { promises as fs } from 'fs'
import path from 'path'
import { resolveTargetDevice, listDevices } from '../utils/resolve-device.js'
import { AndroidManage } from '../android/manage.js'
import { iOSManage } from '../ios/manage.js'
import { findApk } from '../android/utils.js'
import { findAppBundle } from '../ios/utils.js'
import { execSync } from 'child_process'
import type { InstallAppResponse, StartAppResponse, TerminateAppResponse, RestartAppResponse, ResetAppDataResponse } from '../types.js'

export async function detectProjectPlatform(projectPath: string): Promise<'ios'|'android'|'ambiguous'|'unknown'> {
  try {
    const stat = await fs.stat(projectPath).catch(() => null)
    if (stat && stat.isDirectory()) {
      const files = (await fs.readdir(projectPath).catch(() => [])) as string[]
      const hasIos = files.some(f => f.endsWith('.xcodeproj') || f.endsWith('.xcworkspace'))
      const hasAndroid = files.includes('gradlew') || files.includes('build.gradle') || files.includes('settings.gradle') || (files.includes('app') && (await fs.stat(path.join(projectPath, 'app')).catch(() => null)))
      if (hasIos && !hasAndroid) return 'ios'
      if (hasAndroid && !hasIos) return 'android'
      if (hasIos && hasAndroid) return 'ambiguous'
      return 'unknown'
    } else {
      const ext = path.extname(projectPath).toLowerCase()
      if (ext === '.apk') return 'android'
      if (ext === '.ipa' || ext === '.app') return 'ios'
      return 'unknown'
    }
  } catch {
    return 'unknown'
  }
}

export class ToolsManage {
  static async build_android({ projectPath, gradleTask, maxWorkers, gradleCache, forceClean }: { projectPath: string, gradleTask?: string, maxWorkers?: number, gradleCache?: boolean, forceClean?: boolean }) {
    const android = new AndroidManage()
    // prepare gradle options via environment hints
    if (typeof maxWorkers === 'number') process.env.MCP_GRADLE_WORKERS = String(maxWorkers)
    if (typeof gradleCache === 'boolean') process.env.MCP_GRADLE_CACHE = gradleCache ? '1' : '0'
    if (forceClean) process.env.MCP_FORCE_CLEAN_ANDROID = '1'
    const task = gradleTask || 'assembleDebug'
    const artifact = await (android as any).build(projectPath, task)
    return artifact
  }

  static async build_ios({ projectPath, workspace: _workspace, project: _project, scheme: _scheme, destinationUDID, derivedDataPath, buildJobs, forceClean }: { projectPath: string, workspace?: string, project?: string, scheme?: string, destinationUDID?: string, derivedDataPath?: string, buildJobs?: number, forceClean?: boolean }) {
    const ios = new iOSManage()
    // silence unused param lints
    void _workspace; void _project; void _scheme;
    if (derivedDataPath) process.env.MCP_DERIVED_DATA = derivedDataPath
    if (typeof buildJobs === 'number') process.env.MCP_BUILD_JOBS = String(buildJobs)
    if (forceClean) process.env.MCP_FORCE_CLEAN_IOS = '1'
    if (destinationUDID) process.env.MCP_XCODE_DESTINATION_UDID = destinationUDID
    const artifact = await (ios as any).build(projectPath)
    return artifact
  }

  static async build_flutter({ projectPath, platform, buildMode, maxWorkers: _maxWorkers, forceClean: _forceClean }: { projectPath: string, platform?: 'android'|'ios', buildMode?: 'debug'|'release'|'profile', maxWorkers?: number, forceClean?: boolean }) {
    // Prefer using flutter CLI when available; otherwise delegate to native subproject builders
    const flutterCmd = process.env.FLUTTER_PATH || 'flutter'
    // silence unused params
    void _maxWorkers; void _forceClean;
    try {
      // Check flutter presence without streaming output
      execSync(`${flutterCmd} --version`, { stdio: 'ignore' })

      if (!platform || platform === 'android') {
        const mode = buildMode || 'debug'
        try {
          const out = execSync(`${flutterCmd} build apk --${mode}`, { cwd: projectPath, encoding: 'utf8' })
          // Try to find built APK
          const apk = await findApk(path.join(projectPath))
          if (apk) return { artifactPath: apk, output: out }
        } catch (err: any) {
          const stdout = err && err.stdout ? String(err.stdout) : ''
          const stderr = err && err.stderr ? String(err.stderr) : ''
          throw new Error(`flutter build apk failed: ${stderr || stdout || err.message}`)
        }
      }

      if (!platform || platform === 'ios') {
        const mode = buildMode || 'debug'
        try {
          const out = execSync(`${flutterCmd} build ios --${mode} --no-codesign`, { cwd: projectPath, encoding: 'utf8' })
          const app = await findAppBundle(path.join(projectPath))
          if (app) return { artifactPath: app, output: out }
        } catch (err: any) {
          const stdout = err && err.stdout ? String(err.stdout) : ''
          const stderr = err && err.stderr ? String(err.stderr) : ''
          throw new Error(`flutter build ios failed: ${stderr || stdout || err.message}`)
        }
      }
    } catch (e) {
      // If flutter CLI not available or command fails, fall back to native subprojects
      // Preserve error message for diagnostics if needed
      void e
    }

    // Fallback: try native subproject builds
    if (!platform || platform === 'android') {
      const androidDir = path.join(projectPath, 'android')
      const android = new AndroidManage()
      const artifact = await (android as any).build(androidDir, forceClean ? 'clean && assembleDebug' : 'assembleDebug')
      return artifact
    }
    if (!platform || platform === 'ios') {
      const iosDir = path.join(projectPath, 'ios')
      const ios = new iOSManage()
      const artifact = await (ios as any).build(iosDir)
      return artifact
    }

    return { error: 'Unable to build flutter project' }
  }

  static async build_react_native({ projectPath, platform, variant, maxWorkers: _maxWorkers, forceClean: _forceClean }: { projectPath: string, platform?: 'android'|'ios', variant?: string, maxWorkers?: number, forceClean?: boolean }) {
    // silence unused params
    void _maxWorkers; void _forceClean;
    // React Native typically uses native subprojects. Delegate to Android/iOS builders.
    if (!platform || platform === 'android') {
      const androidDir = path.join(projectPath, 'android')
      const android = new AndroidManage()
      const artifact = await (android as any).build(androidDir, variant || 'assembleDebug')
      return artifact
    }
    if (!platform || platform === 'ios') {
      const iosDir = path.join(projectPath, 'ios')
      // Recommend running `pod install` prior to building in CI; not performed automatically here
      const ios = new iOSManage()
      const artifact = await (ios as any).build(iosDir)
      return artifact
    }
    return { error: 'Unable to build react-native project' }
  }

  static async buildAppHandler({ platform, projectPath, variant, projectType: _projectType }: { platform?: 'android' | 'ios', projectPath: string, variant?: string, projectType?: 'native' | 'kmp' | 'react-native' | 'flutter' }) {
    void _projectType;
    // delegate to platform-specific build implementations
    const chosen = platform || 'android'
    if (chosen === 'android') {
      const android = new AndroidManage()
      const artifact = await (android as any).build(projectPath, variant)
      return artifact
    } else {
      const ios = new iOSManage()
      const artifact = await (ios as any).build(projectPath, variant)
      return artifact
    }
  }

  static async installAppHandler({ platform, appPath, deviceId, projectType }: { platform?: 'android' | 'ios', appPath: string, deviceId?: string, projectType?: 'native' | 'kmp' | 'react-native' | 'flutter' }): Promise<InstallAppResponse> {
    // Use projectType hint to influence platform detection when explicit platform is not provided
    let chosenPlatform: 'android'|'ios'|undefined = platform
    if (!chosenPlatform && projectType) {
      // Heuristic defaults: KMP, React Native and Flutter commonly target Android by default in CI
      if (projectType === 'kmp' || projectType === 'react-native' || projectType === 'flutter') {
        chosenPlatform = 'android'
        console.debug('[manage] projectType hint -> selecting android by default for', projectType)
      } else if (projectType === 'native' || projectType === 'ios') {
        chosenPlatform = 'ios'
        console.debug('[manage] projectType hint -> selecting ios by default for', projectType)
      }
    }

    try {
      const stat = await fs.stat(appPath).catch(() => null)
      if (stat && stat.isDirectory()) {
        // If the directory itself looks like an .app bundle, treat as iOS
        if (appPath.endsWith('.app')) {
          chosenPlatform = 'ios'
        } else {
          const files = (await fs.readdir(appPath).catch(() => [])) as string[]
          if (files.some(f => f.endsWith('.xcodeproj') || f.endsWith('.xcworkspace'))) {
            chosenPlatform = 'ios'
          } else if (files.includes('gradlew') || files.includes('build.gradle') || files.includes('settings.gradle') || (files.includes('app') && (await fs.stat(path.join(appPath, 'app')).catch(() => null)))) {
            chosenPlatform = 'android'
          } else {
            chosenPlatform = 'android'
          }
        }
      } else if (typeof appPath === 'string') {
        const ext = path.extname(appPath).toLowerCase()
        if (ext === '.apk') chosenPlatform = 'android'
        else if (ext === '.ipa' || ext === '.app') chosenPlatform = 'ios'
        else chosenPlatform = 'android'
      }
    } catch {
      chosenPlatform = 'android'
    }

    if (chosenPlatform === 'android') {
      const resolved = await resolveTargetDevice({ platform: 'android', deviceId })
      const androidRun = new AndroidManage()
      const result = await androidRun.installApp(appPath, resolved.id)
      return result
    } else {
      const resolved = await resolveTargetDevice({ platform: 'ios', deviceId })
      const iosRun = new iOSManage()
      const result = await iosRun.installApp(appPath, resolved.id)
      return result
    }
  }

  static async startAppHandler({ platform, appId, deviceId }: { platform: 'android' | 'ios', appId: string, deviceId?: string }): Promise<StartAppResponse> {
    if (platform === 'android') {
      const resolved = await resolveTargetDevice({ platform: 'android', appId, deviceId })
      return await new AndroidManage().startApp(appId, resolved.id)
    } else {
      const resolved = await resolveTargetDevice({ platform: 'ios', appId, deviceId })
      return await new iOSManage().startApp(appId, resolved.id)
    }
  }

  static async terminateAppHandler({ platform, appId, deviceId }: { platform: 'android' | 'ios', appId: string, deviceId?: string }): Promise<TerminateAppResponse> {
    if (platform === 'android') {
      const resolved = await resolveTargetDevice({ platform: 'android', appId, deviceId })
      return await new AndroidManage().terminateApp(appId, resolved.id)
    } else {
      const resolved = await resolveTargetDevice({ platform: 'ios', appId, deviceId })
      return await new iOSManage().terminateApp(appId, resolved.id)
    }
  }

  static async restartAppHandler({ platform, appId, deviceId }: { platform: 'android' | 'ios', appId: string, deviceId?: string }): Promise<RestartAppResponse> {
    if (platform === 'android') {
      const resolved = await resolveTargetDevice({ platform: 'android', appId, deviceId })
      return await new AndroidManage().restartApp(appId, resolved.id)
    } else {
      const resolved = await resolveTargetDevice({ platform: 'ios', appId, deviceId })
      return await new iOSManage().restartApp(appId, resolved.id)
    }
  }

  static async resetAppDataHandler({ platform, appId, deviceId }: { platform: 'android' | 'ios', appId: string, deviceId?: string }): Promise<ResetAppDataResponse> {
    if (platform === 'android') {
      const resolved = await resolveTargetDevice({ platform: 'android', appId, deviceId })
      return await new AndroidManage().resetAppData(appId, resolved.id)
    } else {
      const resolved = await resolveTargetDevice({ platform: 'ios', appId, deviceId })
      return await new iOSManage().resetAppData(appId, resolved.id)
    }
  }

  static async buildAndInstallHandler({ platform, projectPath, deviceId, timeout, projectType }: { platform?: 'android' | 'ios', projectPath: string, deviceId?: string, timeout?: number, projectType?: 'native' | 'kmp' | 'react-native' | 'flutter' }) {
    const events: string[] = []
    const pushEvent = (obj: any) => events.push(JSON.stringify(obj))
    const effectiveTimeout = timeout ?? 180000 // reserved for future streaming/timeouts
    void effectiveTimeout

    // determine platform if not provided by inspecting path or projectType hint
    let chosenPlatform = platform
    try {
      if (!chosenPlatform) {
        // If autodetect is disabled, require explicit platform or projectType
        if (process.env.MCP_DISABLE_AUTODETECT === '1') {
          pushEvent({ type: 'build', status: 'failed', error: 'MCP_DISABLE_AUTODETECT=1 requires explicit platform or projectType' })
          return { ndjson: events.join('\n') + '\n', result: { success: false, error: 'MCP_DISABLE_AUTODETECT=1 requires explicit platform or projectType (ios|android).' } }
        }
        // If caller indicated KMP, prefer android by default (most KMP modul8 setups target Android)
        if (projectType === 'kmp') {
          chosenPlatform = 'android'
          pushEvent({ type: 'build', status: 'info', message: 'projectType=kmp -> selecting android platform by default' })
        } else {
          const det = await detectProjectPlatform(projectPath)
          if (det === 'ios' || det === 'android') {
            chosenPlatform = det
          } else if (det === 'ambiguous') {
            pushEvent({ type: 'build', status: 'failed', error: 'Ambiguous project (contains both iOS and Android). Please provide platform: "ios" or "android".' })
            return { ndjson: events.join('\n') + '\n', result: { success: false, error: 'Ambiguous project - please provide explicit platform parameter (ios|android).' } }
          } else {
            // Unknown project type - do not guess. Request explicit platform.
            pushEvent({ type: 'build', status: 'failed', error: 'Unknown project type - unable to autodetect platform. Please provide platform or projectType.' })
            return { ndjson: events.join('\n') + '\n', result: { success: false, error: 'Unknown project type - please provide platform or projectType (ios|android).' } }
          }
        }
      }
    } catch {
      // detection failed; avoid guessing a platform
    }

    pushEvent({ type: 'build', status: 'started', platform: chosenPlatform })

    let buildRes: any
    try {
      buildRes = await ToolsManage.buildAppHandler({ platform: chosenPlatform as any, projectPath })
      if (buildRes && (buildRes as any).error) {
        pushEvent({ type: 'build', status: 'failed', error: (buildRes as any).error })
        return { ndjson: events.join('\n') + '\n', result: { success: false, error: (buildRes as any).error } }
      }
      pushEvent({ type: 'build', status: 'finished', artifactPath: (buildRes as any).artifactPath })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      pushEvent({ type: 'build', status: 'failed', error: msg })
      return { ndjson: events.join('\n') + '\n', result: { success: false, error: msg } }
    }

    // Install phase
    const artifact = (buildRes as any).artifactPath || projectPath
    pushEvent({ type: 'install', status: 'started', artifactPath: artifact, deviceId })
    let installRes: any
    try {
      installRes = await ToolsManage.installAppHandler({ platform: chosenPlatform as any, appPath: artifact, deviceId })
      if (installRes && installRes.installed === true) {
        pushEvent({ type: 'install', status: 'finished', artifactPath: artifact, device: installRes.device })
        return { ndjson: events.join('\n') + '\n', result: { success: true, artifactPath: artifact, device: installRes.device, output: installRes.output } }
      } else {
        pushEvent({ type: 'install', status: 'failed', error: installRes.error || 'unknown' })
        return { ndjson: events.join('\n') + '\n', result: { success: false, error: installRes.error || 'install failed' } }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      pushEvent({ type: 'install', status: 'failed', error: msg })
      return { ndjson: events.join('\n') + '\n', result: { success: false, error: msg } }
    }
  }

  static async listDevicesHandler({ platform, appId }: { platform?: 'android' | 'ios', appId?: string }) {
    const devices = await listDevices(platform as any, appId)
    return { devices }
  }
}
