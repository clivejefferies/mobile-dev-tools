import { AndroidInteract } from './android.js';
import { iOSInteract } from './ios.js';
export { AndroidInteract, iOSInteract };

import { resolveTargetDevice } from '../utils/resolve-device.js'
import { ToolsObserve } from '../observe/index.js'

interface ScreenFingerprintResponse { fingerprint: string | null }

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
          } catch {
            // ignore and continue polling
            continue
          }
        }
      } catch {
        // ignore transient errors
      }

      await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
    }

    return { success: false, reason: 'timeout', lastFingerprint, elapsedMs: Date.now() - start }
  }

}
