import { promises as fs } from 'fs'
import path from 'path'
import { resolveTargetDevice, listDevices } from '../utils/resolve-device.js'
import { AndroidManage } from './android.js'
import { iOSManage } from './ios.js'
import { findApk } from '../utils/android/utils.js'
import { findAppBundle } from '../utils/ios/utils.js'
import { execSync } from 'child_process'
import type { InstallAppResponse, StartAppResponse, TerminateAppResponse, RestartAppResponse, ResetAppDataResponse } from '../types.js'

export { AndroidManage } from './android.js';
export { iOSManage } from './ios.js';

export async function detectProjectPlatform(projectPath: string): Promise<'ios'|'android'|'ambiguous'|'unknown'> {
  // Recursively scan up to a limited depth for platform markers to avoid mis-detection
  async function scan(dir: string, depth = 3): Promise<{ ios: boolean, android: boolean }>{
    const res = { ios: false, android: false }
    try {
      const ents = await fs.readdir(dir).catch(() => [])
      for (const e of ents) {
        if (e.endsWith('.xcworkspace') || e.endsWith('.xcodeproj')) res.ios = true
        if (e === 'gradlew' || e === 'build.gradle' || e === 'settings.gradle') res.android = true
        if (res.ios && res.android) return res
      }

      if (depth <= 0) return res
      for (const e of ents) {
        try {
          const full = path.join(dir, e)
          const st = await fs.stat(full).catch(() => null)
          if (st && st.isDirectory()) {
            const child = await scan(full, depth - 1)
            if (child.ios) res.ios = true
            if (child.android) res.android = true
            if (res.ios && res.android) return res
          }
        } catch {}
      }
    } catch {}
    return res
  }

  try {
    const stat = await fs.stat(projectPath).catch(() => null)
    if (stat && stat.isDirectory()) {
      const { ios: hasIos, android: hasAndroid } = await scan(projectPath, 3)
      if (hasIos && !hasAndroid) return 'ios'
      if (hasAndroid && !hasIos) return 'android'
      if (hasIos && hasAndroid) return 'ambiguous'
      // no explicit markers found
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
    // Use provided options rather than env-only; still set env fallbacks for downstream tools
    if (derivedDataPath) process.env.MCP_DERIVED_DATA = derivedDataPath
    if (typeof buildJobs === 'number') process.env.MCP_BUILD_JOBS = String(buildJobs)
    if (forceClean) process.env.MCP_FORCE_CLEAN_IOS = '1'
    if (destinationUDID) process.env.MCP_XCODE_DESTINATION_UDID = destinationUDID

    const opts: any = {}
    if (_workspace) opts.workspace = _workspace
    if (_project) opts.project = _project
    if (_scheme) opts.scheme = _scheme
    if (destinationUDID) opts.destinationUDID = destinationUDID
    if (derivedDataPath) opts.derivedDataPath = derivedDataPath
    if (forceClean) opts.forceClean = forceClean
    // prefer explicit xcodebuild path from env
    if (process.env.XCODEBUILD_PATH) opts.xcodeCmd = process.env.XCODEBUILD_PATH

    const artifact = await (ios as any).build(projectPath, opts)
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
      const artifact = await (android as any).build(androidDir, _forceClean ? 'clean && assembleDebug' : 'assembleDebug')
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

  static async installAppHandler({ platform, appPath, deviceId, projectType }: { platform: 'android' | 'ios', appPath: string, deviceId?: string, projectType: 'native' | 'kmp' | 'react-native' | 'flutter' }): Promise<InstallAppResponse> {
    // Enforce explicit platform and projectType: both are mandatory to avoid ambiguity
    if (!platform || !projectType) {
      throw new Error('Both platform and projectType parameters are required (platform: ios|android, projectType: native|kmp|react-native|flutter).')
    }

    const chosenPlatform: 'android'|'ios' = platform

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

  static async buildAndInstallHandler({ platform, projectPath, deviceId, timeout, projectType }: { platform: 'android' | 'ios', projectPath: string, deviceId?: string, timeout?: number, projectType: 'native' | 'kmp' | 'react-native' | 'flutter' }) {
    const events: string[] = []
    const pushEvent = (obj: any) => events.push(JSON.stringify(obj))
    const effectiveTimeout = timeout ?? 180000 // reserved for future streaming/timeouts
    void effectiveTimeout

    // Require explicit platform and projectType to avoid ambiguous autodetection
    if (!platform || !projectType) {
      pushEvent({ type: 'build', status: 'failed', error: 'Both platform and projectType parameters are required.' })
      return { ndjson: events.join('\n') + '\n', result: { success: false, error: 'Both platform and projectType parameters are required (platform: ios|android, projectType: native|kmp|react-native|flutter).' } }
    }

    // determine platform if not provided by inspecting path or projectType hint
    let chosenPlatform = platform
    try {
      if (!chosenPlatform) {
        // If caller provided projectType, respect it as a hard override and map to platform
        if (projectType) {
          if (projectType === 'kmp' || projectType === 'react-native' || projectType === 'flutter') {
            chosenPlatform = 'android'
            pushEvent({ type: 'build', status: 'info', message: `projectType=${projectType} -> forcing android platform` })
          } else if (projectType === 'native' || projectType === 'ios') {
            chosenPlatform = 'ios'
            pushEvent({ type: 'build', status: 'info', message: `projectType=${projectType} -> forcing ios platform` })
          } else {
            pushEvent({ type: 'build', status: 'failed', error: `Unknown projectType: ${projectType}` })
            return { ndjson: events.join('\n') + '\n', result: { success: false, error: `Unknown projectType: ${projectType}` } }
          }
        } else {
          // If autodetect is disabled, require explicit platform or projectType
          if (process.env.MCP_DISABLE_AUTODETECT === '1') {
            pushEvent({ type: 'build', status: 'failed', error: 'MCP_DISABLE_AUTODETECT=1 requires explicit platform or projectType' })
            return { ndjson: events.join('\n') + '\n', result: { success: false, error: 'MCP_DISABLE_AUTODETECT=1 requires explicit platform or projectType (ios|android).' } }
          }

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
      installRes = await ToolsManage.installAppHandler({ platform: chosenPlatform as any, appPath: artifact, deviceId, projectType })
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
