import { promises as fs } from 'fs'
import path from 'path'
import { resolveTargetDevice, listDevices } from '../resolve-device.js'
import { AndroidManage } from '../android/manage.js'
import { iOSManage } from '../ios/manage.js'
import type { InstallAppResponse, StartAppResponse, TerminateAppResponse, RestartAppResponse, ResetAppDataResponse } from '../types.js'

export class ToolsManage {
  static async buildAppHandler({ platform, projectPath, variant }: { platform?: 'android' | 'ios', projectPath: string, variant?: string }) {
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

  static async installAppHandler({ platform, appPath, deviceId }: { platform?: 'android' | 'ios', appPath: string, deviceId?: string }): Promise<InstallAppResponse> {
    let chosenPlatform: 'android' | 'ios' | undefined = platform

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

  static async buildAndInstallHandler({ platform, projectPath, deviceId, timeout }: { platform?: 'android' | 'ios', projectPath: string, deviceId?: string, timeout?: number }) {
    const events: string[] = []
    const pushEvent = (obj: any) => events.push(JSON.stringify(obj))
    const effectiveTimeout = timeout ?? 180000 // reserved for future streaming/timeouts
    void effectiveTimeout

    // determine platform if not provided by inspecting path
    let chosenPlatform = platform
    try {
      const stat = await fs.stat(projectPath).catch(() => null)
      if (!chosenPlatform) {
        if (stat && stat.isDirectory()) {
          const files = (await fs.readdir(projectPath).catch(() => [])) as string[]
          if (files.some(f => f.endsWith('.xcodeproj') || f.endsWith('.xcworkspace'))) chosenPlatform = 'ios'
          else chosenPlatform = 'android'
        } else {
          const ext = path.extname(projectPath).toLowerCase()
          if (ext === '.apk') chosenPlatform = 'android'
          else if (ext === '.ipa' || ext === '.app') chosenPlatform = 'ios'
          else chosenPlatform = 'android'
        }
      }
    } catch {
      chosenPlatform = chosenPlatform || 'android'
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
