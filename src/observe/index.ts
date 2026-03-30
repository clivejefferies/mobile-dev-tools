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

  static async getLogsHandler({ platform, appId, deviceId, pid, tag, level, contains, since_seconds, limit, lines }: { platform?: 'android' | 'ios', appId?: string, deviceId?: string, pid?: number, tag?: string, level?: string, contains?: string, since_seconds?: number, limit?: number, lines?: number }) {
    const { observe, resolved } = await ToolsObserve.resolveObserve(platform, deviceId, appId)
    const filters = { appId, deviceId: resolved.id, pid, tag, level, contains, since_seconds, limit: limit ?? lines }

    // Validate filters
    if (level && !['VERBOSE','DEBUG','INFO','WARN','ERROR'].includes(level.toString().toUpperCase())) {
      return { device: resolved, logs: [], crashLines: [], logCount: 0, error: { code: 'INVALID_FILTER', message: `Unsupported level filter: ${level}` } } as any
    }

    if (observe instanceof AndroidObserve) {
      const response = await observe.getLogs(filters)
      const logs = Array.isArray(response.logs) ? response.logs : []
      const crashLines = logs.filter(entry => /FATAL EXCEPTION/i.test(entry.message))
      const anyFilterApplied = !!(appId || pid || tag || level || contains || since_seconds)
      if (anyFilterApplied && logs.length === 0) return { device: response.device, logs: [], crashLines: [], logCount: 0, error: { code: 'LOGS_UNAVAILABLE', message: 'No logs match filters' } } as any
      return { device: response.device, logs, crashLines, logCount: response.logCount }
    } else {
      const resp = await (observe as iOSObserve).getLogs(filters)
      const logs = Array.isArray(resp.logs) ? resp.logs : []
      const crashLines = logs.filter(entry => /FATAL EXCEPTION/i.test(entry.message))
      const anyFilterApplied = !!(appId || pid || tag || level || contains || since_seconds)
      if (anyFilterApplied && logs.length === 0) return { device: resp.device, logs: [], crashLines: [], logCount: 0, error: { code: 'LOGS_UNAVAILABLE', message: 'No logs match filters' } } as any
      return { device: resp.device, logs, crashLines, logCount: resp.logCount }
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

    // Parallel fetches for performance: screenshot, current screen, fingerprint, ui tree, and log stream/get logs
    const sid = sessionId || 'default'
    const tasks: Record<string, Promise<any>> = {
      screenshot: ToolsObserve.captureScreenshotHandler({ platform, deviceId }),
      currentScreen: (!platform || platform === 'android') ? ToolsObserve.getCurrentScreenHandler({ deviceId }) : Promise.resolve(null),
      fingerprint: ToolsObserve.getScreenFingerprintHandler({ platform, deviceId }),
      uiTree: ToolsObserve.getUITreeHandler({ platform, deviceId }),
      readLogStream: includeLogs ? ToolsObserve.readLogStreamHandler({ platform, sessionId: sid, limit: logLines }) : Promise.resolve({ entries: [] }),
    }

    const results = await Promise.allSettled(Object.values(tasks))
    const keys = Object.keys(tasks)

    // Map results back to keys
    for (let i = 0; i < results.length; i++) {
      const key = keys[i]
      const res = results[i] as PromiseSettledResult<any>
      if (res.status === 'fulfilled') {
        const val = res.value
        if (key === 'screenshot') {
          out.screenshot = val && val.screenshot ? val.screenshot : null
        } else if (key === 'currentScreen') {
          out.activity = val && ((val.activity || val.shortActivity)) ? (val.activity || val.shortActivity) : out.activity || ''
        } else if (key === 'fingerprint') {
          if (val && val.fingerprint) out.fingerprint = val.fingerprint
          if (val && val.activity) out.activity = out.activity || val.activity
          if (val && val.error) out.fingerprint_error = val.error
        } else if (key === 'uiTree') {
          out.ui_tree = val
          if (val && val.error) out.ui_tree_error = val.error
        } else if (key === 'readLogStream') {
          // handle below after evaluating fallback
          // temporarily attach to out._streamEntries
          out._streamEntries = val && val.entries ? val.entries : []
        }
      } else {
        const errMsg = res.reason instanceof Error ? res.reason.message : String(res.reason)
        if (key === 'screenshot') out.screenshot_error = errMsg
        if (key === 'currentScreen') out.activity_error = errMsg
        if (key === 'fingerprint') { out.fingerprint = null; out.fingerprint_error = errMsg }
        if (key === 'uiTree') { out.ui_tree = null; out.ui_tree_error = errMsg }
        if (key === 'readLogStream') { out._streamEntries = [] ; out.logs_error = errMsg }
      }
    }

    // Logs: prefer stream entries, fallback to snapshot logs when empty
    if (includeLogs) {
      try {
        let entries: any[] = Array.isArray(out._streamEntries) ? out._streamEntries : []
        if (!entries || entries.length === 0) {
          const gl = await ToolsObserve.getLogsHandler({ platform, appId, deviceId, lines: logLines })
          const raw: any[] = (gl && (gl as any).logs) ? (gl as any).logs : []
          // raw may be structured entries or strings
          entries = raw.slice(-Math.max(0, logLines)).map(item => {
            if (!item) return { timestamp: null, level: 'INFO', message: '' }
            if (typeof item === 'string') {
              const level = /\b(FATAL EXCEPTION|ERROR| E )\b/i.test(item) ? 'ERROR' : /\b(WARN| W )\b/i.test(item) ? 'WARN' : 'INFO'
              return { timestamp: null, level, message: item }
            }
            const msg = item.message || item.msg || JSON.stringify(item)
            const levelRaw = item.level || item.levelName || item._level || ''
            const level = (levelRaw && String(levelRaw)).toUpperCase() || (/\bERROR\b/i.test(msg) ? 'ERROR' : /\bWARN\b/i.test(msg) ? 'WARN' : 'INFO')
            const ts = item.timestamp || item._iso || null
            const tsNum = (ts && typeof ts === 'string') ? (isNaN(new Date(ts).getTime()) ? null : new Date(ts).getTime()) : (typeof ts === 'number' ? ts : null)
            return { timestamp: tsNum, level, message: msg }
          })
        } else {
          entries = entries.map(ent => {
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

    // Clean up internal temporary field
    delete out._streamEntries

    return out
  }
}
