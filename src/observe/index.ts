import { resolveTargetDevice } from '../utils/resolve-device.js'
import { AndroidObserve } from './android.js'
import { iOSObserve } from './ios.js'

export { AndroidObserve } from './android.js'
export { iOSObserve } from './ios.js'

export class ToolsObserve {
  // Resolve a target device and return the appropriate observe instance and resolved info.
  private static async resolveObserve(platform?: 'android' | 'ios', deviceId?: string, appId?: string) {
    if (platform === 'android') {
      const resolved = await resolveTargetDevice({ platform: 'android', deviceId, appId })
      return { observe: new AndroidObserve(), resolved }
    }
    if (platform === 'ios') {
      const resolved = await resolveTargetDevice({ platform: 'ios', deviceId, appId })
      return { observe: new iOSObserve(), resolved }
    }

    // No platform specified: try android then ios
    try {
      const resolved = await resolveTargetDevice({ platform: 'android', deviceId, appId })
      return { observe: new AndroidObserve(), resolved }
    } catch {
      const resolved = await resolveTargetDevice({ platform: 'ios', deviceId, appId })
      return { observe: new iOSObserve(), resolved }
    }
  }

  static async getUITreeHandler({ platform, deviceId }: { platform?: 'android' | 'ios', deviceId?: string }) {
    const { observe, resolved } = await ToolsObserve.resolveObserve(platform, deviceId)
    return await observe.getUITree(resolved.id)
  }

  static async getCurrentScreenHandler({ deviceId }: { deviceId?: string }) {
    const { observe, resolved } = await ToolsObserve.resolveObserve('android', deviceId)
    // getCurrentScreen is Android-specific
    return await (observe as AndroidObserve).getCurrentScreen(resolved.id)
  }

  static async getLogsHandler({ platform, appId, deviceId, lines }: { platform?: 'android' | 'ios', appId?: string, deviceId?: string, lines?: number }) {
    const { observe, resolved } = await ToolsObserve.resolveObserve(platform, deviceId, appId)
    if (observe instanceof AndroidObserve) {
      const response = await observe.getLogs(appId, lines ?? 200, resolved.id)
      const logs = Array.isArray(response.logs) ? response.logs : []
      const crashLines = logs.filter(line => line.includes('FATAL EXCEPTION'))
      return { device: response.device, logs, crashLines }
    } else {
      const resp = await (observe as iOSObserve).getLogs(appId, resolved.id)
      const logs = Array.isArray(resp.logs) ? resp.logs : []
      const crashLines = logs.filter(l => l.includes('FATAL EXCEPTION'))
      return { device: resp.device, logs, crashLines }
    }
  }

  static async startLogStreamHandler({ platform, packageName, level, sessionId, deviceId }: { platform?: 'android' | 'ios', packageName: string, level?: 'error' | 'warn' | 'info' | 'debug', sessionId?: string, deviceId?: string }) {
    const sid = sessionId || 'default'
    const { observe, resolved } = await ToolsObserve.resolveObserve(platform, deviceId, packageName)
    if (observe instanceof AndroidObserve) {
      return await observe.startLogStream(packageName, level || 'error', resolved.id, sid)
    } else {
      return await (observe as iOSObserve).startLogStream(packageName, resolved.id, sid)
    }
  }

  static async readLogStreamHandler({ platform, sessionId, limit, since }: { platform?: 'android' | 'ios', sessionId?: string, limit?: number, since?: string }) {
    const sid = sessionId || 'default'
    const { observe } = await ToolsObserve.resolveObserve(platform)
    return await (observe as any).readLogStream(sid, limit ?? 100, since)
  }

  static async stopLogStreamHandler({ platform, sessionId }: { platform?: 'android' | 'ios', sessionId?: string }) {
    const sid = sessionId || 'default'
    const { observe } = await ToolsObserve.resolveObserve(platform)
    return await (observe as any).stopLogStream(sid)
  }

  static async captureScreenshotHandler({ platform, deviceId }: { platform?: 'android' | 'ios', deviceId?: string }) {
    const { observe, resolved } = await ToolsObserve.resolveObserve(platform, deviceId)
    if (observe instanceof AndroidObserve) {
      return await observe.captureScreen(resolved.id)
    } else {
      return await (observe as iOSObserve).captureScreenshot(resolved.id)
    }
  }

  static async getScreenFingerprintHandler({ platform, deviceId }: { platform?: 'android' | 'ios', deviceId?: string } = {}) {
    const { observe, resolved } = await ToolsObserve.resolveObserve(platform, deviceId)
    // Both observes implement getScreenFingerprint
    return await (observe as any).getScreenFingerprint(resolved.id)
  }

  static async captureDebugSnapshotHandler({ reason, includeLogs = true, logLines = 200, platform, appId, deviceId, sessionId }: { reason?: string; includeLogs?: boolean; logLines?: number; platform?: 'android' | 'ios'; appId?: string; deviceId?: string; sessionId?: string } = {}) {
    const timestamp = Date.now()
    const out: any = { timestamp, reason: reason || '', activity: null, fingerprint: null, screenshot: null, ui_tree: null, logs: [] }

    // 1. Screenshot
    try {
      const ss = await ToolsObserve.captureScreenshotHandler({ platform, deviceId })
      out.screenshot = ss && (ss as any).screenshot ? (ss as any).screenshot : null
    } catch (e) {
      out.screenshot = null
      out.screenshot_error = e instanceof Error ? e.message : String(e)
    }

    // 2. Current Activity (Android-specific)
    try {
      if (!platform || platform === 'android') {
        const cs = await ToolsObserve.getCurrentScreenHandler({ deviceId })
        out.activity = (cs && ((cs as any).activity || (cs as any).shortActivity)) ? ((cs as any).activity || (cs as any).shortActivity) : ''
      }
    } catch (e) {
      out.activity = out.activity || ''
      out.activity_error = e instanceof Error ? e.message : String(e)
    }

    // 3. Screen Fingerprint
    try {
      const fpRes = await ToolsObserve.getScreenFingerprintHandler({ platform, deviceId })
      if (fpRes && (fpRes as any).fingerprint) out.fingerprint = (fpRes as any).fingerprint
      if (fpRes && (fpRes as any).activity) out.activity = out.activity || (fpRes as any).activity
      if (fpRes && (fpRes as any).error) out.fingerprint_error = (fpRes as any).error
    } catch (e) {
      out.fingerprint = null
      out.fingerprint_error = e instanceof Error ? e.message : String(e)
    }

    // 4. UI Tree
    try {
      const tree = await ToolsObserve.getUITreeHandler({ platform, deviceId })
      out.ui_tree = tree
      if (tree && (tree as any).error) out.ui_tree_error = (tree as any).error
    } catch (e) {
      out.ui_tree = null
      out.ui_tree_error = e instanceof Error ? e.message : String(e)
    }

    // 5. Logs (optional)
    if (includeLogs) {
      try {
        const sid = sessionId || 'default'
        const streamRes = await ToolsObserve.readLogStreamHandler({ platform, sessionId: sid, limit: logLines })
        let entries: any[] = (streamRes && (streamRes as any).entries) ? (streamRes as any).entries : []

        if (!entries || entries.length === 0) {
          // Fallback to snapshot logs
          const gl = await ToolsObserve.getLogsHandler({ platform, appId, deviceId, lines: logLines })
          const raw: string[] = (gl && (gl as any).logs) ? (gl as any).logs : []
          entries = raw.slice(-Math.max(0, logLines)).map(line => {
            const level = /\b(FATAL EXCEPTION|ERROR| E )\b/i.test(line) ? 'ERROR' : /\b(WARN| W )\b/i.test(line) ? 'WARN' : 'INFO'
            return { timestamp: null, level, message: line }
          })
        } else {
          entries = entries.slice(-Math.max(0, logLines)).map(ent => {
            const msg = (ent && (ent.message || ent.msg)) ? (ent.message || ent.msg) : (typeof ent === 'string' ? ent : JSON.stringify(ent))
            const levelRaw = (ent && (ent.level || ent.levelName || ent._level)) ? (ent.level || ent.levelName || ent._level) : ''
            const level = (levelRaw && String(levelRaw)).toString().toUpperCase() || (/\bERROR\b/i.test(msg) ? 'ERROR' : /\bWARN\b/i.test(msg) ? 'WARN' : 'INFO')
            let tsNum: number | null = null
            const maybeIso = ent && ((ent._iso || ent.timestamp) as any)
            if (maybeIso && typeof maybeIso === 'string') {
              const d = new Date(maybeIso)
              if (!isNaN(d.getTime())) tsNum = d.getTime()
            }
            return { timestamp: tsNum, level, message: msg }
          })
        }

        out.logs = entries
      } catch (e) {
        out.logs = []
        out.logs_error = e instanceof Error ? e.message : String(e)
      }
    }

    return out
  }
}
