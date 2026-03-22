import { WaitForElementResponse, TapResponse, SwipeResponse, TypeTextResponse, PressBackResponse } from "../types.js"
import { execAdb, getAndroidDeviceMetadata, getDeviceInfo } from "./utils.js"
import { AndroidObserve } from "./observe.js"


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

  async scrollToElement(selector: { text?: string, resourceId?: string, contentDesc?: string, className?: string }, direction: 'down' | 'up' = 'down', maxScrolls = 10, scrollAmount = 0.7, deviceId?: string) {
    const fetchTree = async () => await this.observe.getUITree(deviceId)

    const matchElement = (el: any) => {
      if (!el) return false
      if (selector.text !== undefined && selector.text !== el.text) return false
      if (selector.resourceId !== undefined && selector.resourceId !== el.resourceId) return false
      if (selector.contentDesc !== undefined && selector.contentDesc !== el.contentDescription) return false
      if (selector.className !== undefined && selector.className !== el.type) return false
      return true
    }

    // Initial check
    let tree = await fetchTree()
    if (tree.error) return { success: false, reason: tree.error, scrollsPerformed: 0 }

    const isVisible = (el: any, resolution: any) => {
      if (!el) return false
      if (el.visible === false) return false
      // If bounds or resolution missing, fall back to visible flag or assume visible
      if (!el.bounds || !resolution || !resolution.width || !resolution.height) return (el.visible === undefined ? true : !!el.visible)
      const [left, top, right, bottom] = el.bounds
      const withinY = bottom > 0 && top < resolution.height
      const withinX = right > 0 && left < resolution.width
      return withinX && withinY
    }

    const findVisibleMatch = (elements: any[], resolution: any) => {
      if (!Array.isArray(elements)) return null
      for (const e of elements) {
        if (matchElement(e) && isVisible(e, resolution)) return e
      }
      return null
    }

    let found = findVisibleMatch(tree.elements, tree.resolution)
    if (found) {
      return { success: true, element: { text: found.text, resourceId: found.resourceId, bounds: found.bounds }, scrollsPerformed: 0 }
    }

    const fingerprintOf = (t: any) => {
      try {
        return JSON.stringify((t.elements || []).map((e: any) => ({ text: e.text, resourceId: e.resourceId, bounds: e.bounds })))
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
        await this.swipe(x1, y1, x2, y2, duration, deviceId)
      } catch {
        // swallow and continue
      }

      scrollsPerformed++
      await new Promise(resolve => setTimeout(resolve, 350))

      tree = await fetchTree()
      if (tree.error) return { success: false, reason: tree.error, attempts: scrollsPerformed }

      found = findVisibleMatch(tree.elements, tree.resolution)
      if (found) {
        return { success: true, element: { text: found.text, resourceId: found.resourceId, bounds: found.bounds }, scrollsPerformed }
      }

      const fp = fingerprintOf(tree)
      if (fp === prevFingerprint) {
        return { success: false, reason: 'UI unchanged after scroll; likely end of list', attempts: scrollsPerformed }
      }
      prevFingerprint = fp
    }

    return { success: false, reason: 'Element not found after scrolling', attempts: scrollsPerformed }
  }

}
