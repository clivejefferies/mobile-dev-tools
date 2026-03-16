import { resolveTargetDevice } from '../resolve-device.js'
import { AndroidObserve } from '../android/observe.js'
import { iOSObserve } from '../ios/observe.js'

export class ToolsObserve {
  static async getUITreeHandler({ platform, deviceId }: { platform: 'android' | 'ios', deviceId?: string }) {
    if (platform === 'android') {
      const resolved = await resolveTargetDevice({ platform: 'android', deviceId })
      return await new AndroidObserve().getUITree(resolved.id)
    } else {
      const resolved = await resolveTargetDevice({ platform: 'ios', deviceId })
      return await new iOSObserve().getUITree(resolved.id)
    }
  }

  static async getCurrentScreenHandler({ deviceId }: { deviceId?: string }) {
    const resolved = await resolveTargetDevice({ platform: 'android', deviceId })
    return await new AndroidObserve().getCurrentScreen(resolved.id)
  }

  static async getLogsHandler({ platform, appId, deviceId, lines }: { platform: 'android' | 'ios', appId?: string, deviceId?: string, lines?: number }) {
    if (platform === 'android') {
      const resolved = await resolveTargetDevice({ platform: 'android', appId, deviceId })
      const response = await new AndroidObserve().getLogs(appId, lines ?? 200, resolved.id)
      const logs = Array.isArray(response.logs) ? response.logs : []
      const crashLines = logs.filter(line => line.includes('FATAL EXCEPTION'))
      return { device: response.device, logs, crashLines }
    } else {
      const resolved = await resolveTargetDevice({ platform: 'ios', appId, deviceId })
      const resp = await new iOSObserve().getLogs(appId, resolved.id)
      const logs = Array.isArray(resp.logs) ? resp.logs : []
      const crashLines = logs.filter(l => l.includes('FATAL EXCEPTION'))
      return { device: resp.device, logs, crashLines }
    }
  }

  static async startLogStreamHandler({ platform, packageName, level, sessionId, deviceId }: { platform?: 'android' | 'ios', packageName: string, level?: 'error' | 'warn' | 'info' | 'debug', sessionId?: string, deviceId?: string }) {
    const effectivePlatform = platform || 'android'
    const sid = sessionId || 'default'
    if (effectivePlatform === 'android') {
      const resolved = await resolveTargetDevice({ platform: 'android', appId: packageName, deviceId })
      // Delegate to AndroidObserve's log stream methods
      return await new AndroidObserve().startLogStream(packageName, level || 'error', resolved.id, sid)
    } else {
      const resolved = await resolveTargetDevice({ platform: 'ios', appId: packageName, deviceId })
      // Delegate to iOSObserve for starting log streams
      return await new iOSObserve().startLogStream(packageName, resolved.id, sid)
    }
  }

  static async readLogStreamHandler({ platform, sessionId, limit, since }: { platform?: 'android' | 'ios', sessionId?: string, limit?: number, since?: string }) {
    const effectivePlatform = platform || 'android'
    const sid = sessionId || 'default'
    if (effectivePlatform === 'android') {
      return await new AndroidObserve().readLogStream(sid, limit ?? 100, since)
    } else {
      return await new iOSObserve().readLogStream(sid, limit ?? 100, since)
    }
  }

  static async stopLogStreamHandler({ platform, sessionId }: { platform?: 'android' | 'ios', sessionId?: string }) {
    const effectivePlatform = platform || 'android'
    const sid = sessionId || 'default'
    if (effectivePlatform === 'android') {
      return await new AndroidObserve().stopLogStream(sid)
    } else {
      return await new iOSObserve().stopLogStream(sid)
    }
  }

  static async captureScreenshotHandler({ platform, deviceId }: { platform?: 'android' | 'ios', deviceId?: string }) {
    const effectivePlatform = platform || 'android'
    if (effectivePlatform === 'android') {
      const resolved = await resolveTargetDevice({ platform: 'android', deviceId })
      return await new AndroidObserve().captureScreen(resolved.id)
    } else {
      const resolved = await resolveTargetDevice({ platform: 'ios', deviceId })
      return await new iOSObserve().captureScreenshot(resolved.id)
    }
  }
}

