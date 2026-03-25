import { AndroidInteract } from './android.js';
import { iOSInteract } from './ios.js';
export { AndroidInteract, iOSInteract };

import { resolveTargetDevice } from '../utils/resolve-device.js'
import { ToolsObserve } from '../observe/index.js'

interface ScreenFingerprintResponse { fingerprint: string | null }

interface UiElement {
  text?: string | null
  label?: string | null
  value?: string | null
  contentDescription?: string | null
  contentDesc?: string | null
  accessibilityLabel?: string | null
  resourceId?: string | null
  resourceID?: string | null
  id?: string | null
  type?: string | null
  class?: string | null
  bounds?: number[] | null
  clickable?: boolean
  enabled?: boolean
  focusable?: boolean
  visible?: boolean
  parentId?: number | string | null
  _index?: number
  _interactable?: boolean
}

const STABLE_IDLE_MS = 1000

export class ToolsInteract {

  private static async getInteractionService(platform?: 'android' | 'ios', deviceId?: string) {
    const effectivePlatform = platform || 'android'
    const resolved = await resolveTargetDevice({ platform: effectivePlatform as 'android' | 'ios', deviceId })
    const interact = effectivePlatform === 'android' ? new AndroidInteract() : new iOSInteract()
    return { interact: interact as any, resolved, platform: effectivePlatform }
  }

  static async waitForElementHandler({ platform, text, timeout, deviceId }: { platform: 'android' | 'ios', text: string, timeout?: number, deviceId?: string }) {
    const effectiveTimeout = timeout ?? 10000
    const { interact, resolved } = await ToolsInteract.getInteractionService(platform, deviceId)
    return await interact.waitForElement(text, effectiveTimeout, resolved.id)
  }

  static async tapHandler({ platform, x, y, deviceId }: { platform?: 'android' | 'ios', x: number, y: number, deviceId?: string }) {
    const { interact, resolved } = await ToolsInteract.getInteractionService(platform, deviceId)
    return await interact.tap(x, y, resolved.id)
  }

  static async swipeHandler({ platform = 'android', x1, y1, x2, y2, duration, deviceId }: { platform?: 'android' | 'ios', x1: number, y1: number, x2: number, y2: number, duration: number, deviceId?: string }) {
    const { interact, resolved } = await ToolsInteract.getInteractionService(platform, deviceId)
    return await interact.swipe(x1, y1, x2, y2, duration, resolved.id)
  }

  static async typeTextHandler({ text, deviceId }: { text: string, deviceId?: string }) {
    const resolved = await resolveTargetDevice({ platform: 'android', deviceId })
    return await new AndroidInteract().typeText(text, resolved.id)
  }

  static async pressBackHandler({ deviceId }: { deviceId?: string }) {
    const resolved = await resolveTargetDevice({ platform: 'android', deviceId })
    return await new AndroidInteract().pressBack(resolved.id)
  }

  static async scrollToElementHandler({ platform, selector, direction = 'down', maxScrolls = 10, scrollAmount = 0.7, deviceId }: { platform: 'android' | 'ios', selector: { text?: string, resourceId?: string, contentDesc?: string, className?: string }, direction?: 'down' | 'up', maxScrolls?: number, scrollAmount?: number, deviceId?: string }) {
    const { interact, resolved } = await ToolsInteract.getInteractionService(platform, deviceId)
    return await interact.scrollToElement(selector, direction, maxScrolls, scrollAmount, resolved.id)
  }

  static async findElementHandler({ query, exact = false, timeoutMs = 3000, platform, deviceId }: { query: string, exact?: boolean, timeoutMs?: number, platform?: 'android' | 'ios', deviceId?: string }) {
    // Try to use observe layer to fetch the current UI tree and perform a fast semantic search
    const start = Date.now()
    const deadline = start + timeoutMs
    const normalize = (s: any) => (s === null || s === undefined) ? '' : String(s).toLowerCase().trim()

    const q = normalize(query)
    if (!q) return { found: false, error: 'Empty query' }

    let best: UiElement | null = null
    let bestScore = 0

    const scoreElement = (el: UiElement | null) => {
      if (!el || !el.visible) return 0
      const bounds = el.bounds || [0,0,0,0]
      if (!Array.isArray(bounds) || bounds.length < 4) return 0
      const [l,t,r,b] = bounds
      if (r <= l || b <= t) return 0
      // Do not early-return on non-interactable elements — score them so we can locate their clickable ancestor later
      const interactable = !!(el.clickable || el.enabled || el.focusable)

      const text = normalize(el.text ?? el.label ?? el.value ?? '')
      const content = normalize(el.contentDescription ?? el.contentDesc ?? el.accessibilityLabel ?? '')
      const resourceId = normalize(el.resourceId ?? el.resourceID ?? el.id ?? '')
      const className = normalize(el.type ?? el.class ?? '')

      let score = 0
      if (exact) {
        if (text && text === q) score = 1.0
        else if (content && content === q) score = 0.95
      } else {
        if (text && text === q) score = 1.0
        else if (content && content === q) score = 0.95
        else if (text && text.includes(q)) score = 0.6
        else if (content && content.includes(q)) score = 0.55
        else if (resourceId && resourceId.includes(q)) score = 0.7
        else if (className && className.includes(q)) score = 0.3
      }
      if (score > 0 && interactable) score += 0.05
      return score
    }

    while (Date.now() <= deadline) {
      try {
        const tree = await ToolsObserve.getUITreeHandler({ platform, deviceId })
        if (tree && Array.isArray((tree as any).elements)) {
          const elements = ((tree as any).elements as UiElement[])
          for (let i = 0; i < elements.length; i++) {
            const el = elements[i]
            try {
              const s = scoreElement(el)
              const interactable = !!(el.clickable || el.enabled || (el as any).focusable)
              if (s > bestScore) {
                bestScore = s
                best = el as UiElement
                if (best) { best._index = i; best._interactable = interactable }
              }
              if (bestScore >= 0.95) break
            } catch (e) { console.error('Error scoring element:', e) }
          }
          if (bestScore >= 0.95) break
        }
      } catch (e) { console.error('Error fetching UI tree:', e) }
      if (Date.now() > deadline) break
      await new Promise(r => setTimeout(r, 100))
    }

    if (!best) return { found: false, error: 'Element not found' }

    // If the best match is not interactable, try to resolve an actionable ancestor.
    try {
      const tree = await ToolsObserve.getUITreeHandler({ platform, deviceId }) as any
      const elements = (tree && Array.isArray(tree.elements)) ? (tree.elements as UiElement[]) : []
      let chosen = best as any
      const childBounds = Array.isArray(chosen?.bounds) ? chosen.bounds : null

      // Strategy 1: if parentId references an index, climb that chain
      let resolvedAncestor: any = null
      if (childBounds && (chosen.parentId !== undefined && chosen.parentId !== null)) {
        let cur = chosen
        let safety = 0
        while (cur && safety < 20 && !(cur.clickable || cur.focusable) && (cur.parentId !== undefined && cur.parentId !== null)) {
          let pid = cur.parentId
          let idx: number | null = null
          if (typeof pid === 'number') idx = pid
          else if (typeof pid === 'string' && /^\d+$/.test(pid)) idx = Number(pid)
          // If parentId is not an index, try to find by matching resourceId or id field
          if (idx !== null && elements[idx]) {
            cur = elements[idx]
            if (cur && (cur.clickable || cur.enabled || cur.focusable)) { resolvedAncestor = cur; break }
          } else if (typeof pid === 'string') {
            // fallback: search elements for matching resourceId or id
            const found = elements.find((el: UiElement)=> (el.resourceId === pid || el.id === pid))
            if (found) {
              cur = found
              if (cur && (cur.clickable || cur.enabled || cur.focusable)) { resolvedAncestor = cur; break }
              // otherwise continue climbing if this found element has its own parentId
            } else {
              break
            }
          } else {
            break
          }
          safety++
        }
      }

      // Strategy 2: fallback - find a clickable element whose bounds fully contain the child's bounds
      if (!resolvedAncestor && childBounds) {
        const [cl,ct,cr,cb] = childBounds
        // find candidates that are clickable and contain the child bounds
        const candidates = elements.filter((el: UiElement)=> el && (el.clickable || el.focusable) && Array.isArray(el.bounds) && el.bounds!.length>=4).map((el: UiElement)=>({el, bounds: el.bounds! as number[]}))
        let bestCandidate: any = null
        let bestCandidateArea = Infinity
        for (const c of candidates) {
          const [pl,pt,pr,pb] = c.bounds
          if (pl <= cl && pt <= ct && pr >= cr && pb >= cb) {
            const area = (pr-pl) * (pb-pt)
            if (area < bestCandidateArea) { bestCandidateArea = area; bestCandidate = c.el }
          }
        }
        if (bestCandidate) resolvedAncestor = bestCandidate
      }

      if (resolvedAncestor) {
        best = resolvedAncestor
        // small score bump to reflect actionability
        bestScore = Math.min(1, bestScore + 0.02)
      }
    } catch (e) { console.error('Error resolving ancestor:', e) }

    if (!best) return { found: false, error: 'Element not found' }

    const boundsObj = Array.isArray(best.bounds) ? { left: best.bounds[0], top: best.bounds[1], right: best.bounds[2], bottom: best.bounds[3] } : null
    const tapCoordinates = boundsObj ? { x: Math.floor((boundsObj.left + boundsObj.right) / 2), y: Math.floor((boundsObj.top + boundsObj.bottom) / 2) } : null

    const outEl = {
      text: best.text ?? null,
      resourceId: best.resourceId ?? null,
      contentDesc: best.contentDescription ?? best.contentDesc ?? null,
      class: best.type ?? best.class ?? null,
      bounds: boundsObj,
      clickable: !!best.clickable,
      enabled: !!best.enabled,
      tapCoordinates,
      telemetry: {
        matchedIndex: best?._index ?? null,
        matchedInteractable: !!best?._interactable
      }
    }
    const scoreVal = Math.min(1, Number(bestScore.toFixed(3)))
    return { found: true, element: outEl, score: scoreVal, confidence: scoreVal }
  }

  static async waitForScreenChangeHandler({ platform, previousFingerprint, timeoutMs = 5000, pollIntervalMs = 300, deviceId }: { platform?: 'android' | 'ios', previousFingerprint: string, timeoutMs?: number, pollIntervalMs?: number, deviceId?: string }) {
    const start = Date.now()
    let lastFingerprint: string | null = null

    while (Date.now() - start < timeoutMs) {
      try {
        const res = await ToolsObserve.getScreenFingerprintHandler({ platform, deviceId }) as ScreenFingerprintResponse | null
        const fp = res?.fingerprint ?? null
        if (fp === null || fp === undefined) {
          lastFingerprint = null
          await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
          continue
        }

        lastFingerprint = fp

        if (fp !== previousFingerprint) {
          // Stability confirmation
          await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
              try {
            const confirmRes = await ToolsObserve.getScreenFingerprintHandler({ platform, deviceId }) as ScreenFingerprintResponse | null
            const confirmFp = confirmRes?.fingerprint ?? null
            if (confirmFp === fp) {
              return { success: true, newFingerprint: fp, elapsedMs: Date.now() - start }
            }
            lastFingerprint = confirmFp
            continue
          } catch (e) { console.error('Error confirming fingerprint:', e); continue }
        }
      } catch (e) { console.error('Error getting screen fingerprint:', e) }

      await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
    }

    return { success: false, reason: 'timeout', lastFingerprint, elapsedMs: Date.now() - start }
  }

  static async observeUntilHandler({ type, query, timeoutMs = 5000, pollIntervalMs = 200, platform, deviceId }: { type: 'ui' | 'log' | 'screen' | 'idle', query?: string, timeoutMs?: number, pollIntervalMs?: number, platform?: 'android' | 'ios', deviceId?: string }) {
    const start = Date.now()
    const deadline = start + (timeoutMs || 0)
    const q = (query === null || query === undefined) ? '' : String(query)

    // Baseline state
    let initialFingerprint: string | null = null
    try {
      const fpRes = await ToolsObserve.getScreenFingerprintHandler({ platform, deviceId }) as ScreenFingerprintResponse | null
      initialFingerprint = fpRes?.fingerprint ?? null
    } catch (err) { console.error('observeUntil: error getting initial fingerprint', err); initialFingerprint = null }

    // For logs, capture a baseline snapshot (count or last line) to avoid matching historical lines
    let baselineLastLine: string | null = null
    try {
      const gl = await ToolsObserve.getLogsHandler({ platform, deviceId, lines: 200 })
      const logsArr = Array.isArray((gl as any).logs) ? (gl as any).logs : []
      baselineLastLine = logsArr.length ? logsArr[logsArr.length - 1] : null
    } catch (err) {
      // non-fatal but surface warning to aid debugging
      try { console.warn('observeUntil: failed to get baseline logs (non-fatal):', err instanceof Error ? err.message : String(err)) } catch (_) {}
    }

    
    let lastChangeAt = Date.now()
    let prevFingerprint = initialFingerprint

    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

    // Telemetry
    let pollCount = 0
    let timeToMatch: number | null = null
    let matchSource: string | null = null

    while (Date.now() <= deadline) {
      pollCount++
      try {
        if (type === 'ui') {
          // fast findElement with short timeout to avoid blocking
          try {
            const found = await ToolsInteract.findElementHandler({ query: q, exact: false, timeoutMs: Math.min(500, timeoutMs || 500), platform, deviceId })
            if (found && (found as any).found) {
              timeToMatch = Date.now() - start
              // determine matchSource heuristics
              const el = (found as any).element || {}
              if (el && el.resourceId && String(el.resourceId).toLowerCase().includes(q.toLowerCase())) matchSource = 'ui-resourceId'
              else if (el && el.text && String(el.text).toLowerCase() === q.toLowerCase()) matchSource = 'ui-exact'
              else matchSource = 'ui-partial'

              return { success: true, type: 'ui', matched: true, details: `UI element matched '${q}'`, timestamp: Date.now(), element: (found as any).element, telemetry: { pollCount, timeToMatch, elapsedMs: Date.now() - start, matchSource } }
            }
          } catch (err) { console.error('observeUntil(ui) find error:', err) }
        } else if (type === 'log') {
          try {
            // Try reading from active stream first
            const stream = await ToolsObserve.readLogStreamHandler({ platform, sessionId: 'default', limit: 200 }) as any
            const entries = (stream && Array.isArray(stream.entries)) ? stream.entries : []
            for (const ent of entries) {
              const msg = ent && (ent.message || ent.msg || ent) ? (ent.message || ent.msg || ent) : ''
              if (q && String(msg).includes(q)) {
                timeToMatch = Date.now() - start
                matchSource = 'log-stream'
                return { success: true, type: 'log', matched: true, details: `Log matched '${q}'`, timestamp: Date.now(), log: { message: msg, raw: ent }, telemetry: { pollCount, timeToMatch, elapsedMs: Date.now() - start, matchSource } }
              }
            }

            // Fallback to snapshot logs
            const gl = await ToolsObserve.getLogsHandler({ platform, deviceId, lines: 200 }) as any
            const logsArr = Array.isArray(gl && gl.logs) ? gl.logs : []
            // Only consider new lines after baselineLastLine when possible
            let startIndex = 0
            if (baselineLastLine) {
              const idx = logsArr.lastIndexOf(baselineLastLine)
              startIndex = idx >= 0 ? idx + 1 : 0
            }
            for (let i = startIndex; i < logsArr.length; i++) {
              const line = logsArr[i]
              if (q && String(line).includes(q)) {
                timeToMatch = Date.now() - start
                matchSource = 'log-snapshot'
                return { success: true, type: 'log', matched: true, details: `Log matched '${q}'`, timestamp: Date.now(), log: { message: line }, telemetry: { pollCount, timeToMatch, elapsedMs: Date.now() - start, matchSource } }
              }
            }
          } catch (err) { console.error('observeUntil(log) error:', err) }
        } else if (type === 'screen') {
          try {
            const fpRes = await ToolsObserve.getScreenFingerprintHandler({ platform, deviceId }) as ScreenFingerprintResponse | null
            const fp = fpRes?.fingerprint ?? null
            if (fp !== null && fp !== undefined && fp !== initialFingerprint) {
              if (q) {
                // optionally validate query against new screen context
                try {
                  const found = await ToolsInteract.findElementHandler({ query: q, exact: false, timeoutMs: Math.min(500, timeoutMs || 500), platform, deviceId })
                  if (found && (found as any).found) {
                    timeToMatch = Date.now() - start
                    matchSource = 'screen-validated-ui'
                    return { success: true, type: 'screen', matched: true, details: `Screen changed and query matched on new screen`, timestamp: Date.now(), newFingerprint: fp, element: (found as any).element, telemetry: { pollCount, timeToMatch, elapsedMs: Date.now() - start, matchSource } }
                  }
                } catch (err) { console.error('observeUntil(screen) find error:', err) }
                // If query provided but not matched yet, continue polling until timeout
              } else {
                timeToMatch = Date.now() - start
                matchSource = 'screen-fingerprint'
                return { success: true, type: 'screen', matched: true, details: 'Screen fingerprint changed', timestamp: Date.now(), newFingerprint: fp, telemetry: { pollCount, timeToMatch, elapsedMs: Date.now() - start, matchSource } }
              }
            }
          } catch (err) { console.error('observeUntil(screen) error:', err) }
        } else if (type === 'idle') {
          try {
            const fpRes = await ToolsObserve.getScreenFingerprintHandler({ platform, deviceId }) as ScreenFingerprintResponse | null
            const fp = fpRes?.fingerprint ?? null
            if (fp !== prevFingerprint) {
              prevFingerprint = fp
              lastChangeAt = Date.now()
            } else {
              if (Date.now() - lastChangeAt >= STABLE_IDLE_MS) {
                timeToMatch = Date.now() - start
                matchSource = 'idle-stable'
                return { success: true, type: 'idle', matched: true, details: `UI stable for ${STABLE_IDLE_MS}ms`, timestamp: Date.now(), fingerprint: fp, telemetry: { pollCount, timeToMatch, elapsedMs: Date.now() - start, matchSource } }
              }
            }
          } catch (err) { console.error('observeUntil(idle) error:', err) }
        }
      } catch (err) {
        console.error('observeUntil: unexpected error', err)
      }

      // Respect poll interval and avoid tight loop
      await sleep(pollIntervalMs || 200)
    }

    // On timeout, capture a failure snapshot to aid debugging (best-effort)
    let snapshot: any = null
    try {
      snapshot = await ToolsObserve.captureDebugSnapshotHandler({ reason: `observe_until timeout for ${type}`, includeLogs: true, platform, deviceId })
    } catch (err) {
      snapshot = { error: err instanceof Error ? err.message : String(err) }
    }

    const elapsed = Date.now() - start
    return { success: false, error: 'Timeout waiting for condition', type, timeoutMs, telemetry: { pollCount, elapsedMs: elapsed, matchSource: null }, snapshot }
  }

}
