import { UIElement, GetUITreeResponse, SwipeResponse } from '../../types.js'

export interface ScrollSelector { text?: string; resourceId?: string; contentDesc?: string; className?: string }

export async function scrollToElementShared(opts: {
  selector: ScrollSelector,
  direction?: 'down' | 'up',
  maxScrolls?: number,
  scrollAmount?: number,
  deviceId?: string,
  fetchTree: () => Promise<GetUITreeResponse>,
  swipe: (x1: number, y1: number, x2: number, y2: number, duration: number, deviceId?: string) => Promise<SwipeResponse>,
  stabilizationDelayMs?: number
}): Promise<{ success: boolean; reason?: string; element?: Partial<UIElement>; scrollsPerformed: number }> {
  const { selector, direction = 'down', maxScrolls = 10, scrollAmount = 0.7, deviceId, fetchTree, swipe, stabilizationDelayMs = 350 } = opts

  const matchElement = (el?: UIElement) => {
    if (!el) return false
    if (selector.text !== undefined && selector.text !== el.text) return false
    if (selector.resourceId !== undefined && selector.resourceId !== el.resourceId) return false
    if (selector.contentDesc !== undefined && selector.contentDesc !== el.contentDescription) return false
    if (selector.className !== undefined && selector.className !== el.type) return false
    return true
  }

  const isVisible = (el?: UIElement, resolution?: GetUITreeResponse['resolution']) => {
    if (!el) return false
    if (el.visible === false) return false
    if (!el.bounds || !resolution || !resolution.width || !resolution.height) return (el.visible === undefined ? true : !!el.visible)
    const [left, top, right, bottom] = el.bounds
    const withinY = bottom > 0 && top < resolution.height
    const withinX = right > 0 && left < resolution.width
    return withinX && withinY
  }

  const findVisibleMatch = (elements?: UIElement[], resolution?: GetUITreeResponse['resolution']) => {
    if (!Array.isArray(elements)) return null
    for (const e of elements) {
      if (matchElement(e) && isVisible(e, resolution)) return e
    }
    return null
  }

  // Initial check
  let tree = await fetchTree()
  if (tree.error) return { success: false, reason: tree.error, scrollsPerformed: 0 }

  let found = findVisibleMatch(tree.elements, tree.resolution)
  if (found) {
    return { success: true, element: { text: found.text, resourceId: found.resourceId, bounds: found.bounds }, scrollsPerformed: 0 }
  }

  const fingerprintOf = (t: GetUITreeResponse) => {
    try {
      return JSON.stringify((t.elements || []).map((e: UIElement) => ({ text: e.text, resourceId: e.resourceId, bounds: e.bounds })))
    } catch {
      return ''
    }
  }

  let prevFingerprint = fingerprintOf(tree)

  const width = (tree.resolution && tree.resolution.width) ? tree.resolution.width : 0
  const height = (tree.resolution && tree.resolution.height) ? tree.resolution.height : 0
  const centerX = Math.round(width / 2) || 50

  const clampPct = (v: number) => Math.max(0.05, Math.min(0.95, v))
  const computeCoords = () => {
    const defaultStart = direction === 'down' ? 0.8 : 0.2
    const startPct = clampPct(defaultStart)
    const endPct = clampPct(defaultStart + (direction === 'down' ? -scrollAmount : scrollAmount))
    const x1 = centerX
    const x2 = centerX
    const y1 = Math.round((height || 100) * startPct)
    const y2 = Math.round((height || 100) * endPct)
    return { x1, y1, x2, y2 }
  }

  const duration = 300
  let scrollsPerformed = 0

  for (let i = 0; i < maxScrolls; i++) {
    const { x1, y1, x2, y2 } = computeCoords()
    try {
      await swipe(x1, y1, x2, y2, duration, deviceId)
    } catch (e) {
      // Log swipe failures to aid debugging but don't fail the overall flow
      try { console.warn(`scrollToElement swipe failed: ${e instanceof Error ? e.message : String(e)}`) } catch {}
    }

    scrollsPerformed++
    await new Promise(resolve => setTimeout(resolve, stabilizationDelayMs))

    tree = await fetchTree()
    if (tree.error) return { success: false, reason: tree.error, scrollsPerformed: scrollsPerformed }

    found = findVisibleMatch(tree.elements, tree.resolution)
    if (found) {
      return { success: true, element: { text: found.text, resourceId: found.resourceId, bounds: found.bounds }, scrollsPerformed }
    }

    const fp = fingerprintOf(tree)
    if (fp === prevFingerprint) {
      return { success: false, reason: 'UI unchanged after scroll; likely end of list', scrollsPerformed: scrollsPerformed }
    }
    prevFingerprint = fp
  }

  return { success: false, reason: 'Element not found after scrolling', scrollsPerformed: scrollsPerformed }
}
