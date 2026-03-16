import { resolveTargetDevice } from '../resolve-device.js'
import { AndroidInteract } from '../android/interact.js'
import { iOSInteract } from '../ios/interact.js'

export class ToolsInteract {

  static async waitForElementHandler({ platform, text, timeout, deviceId }: { platform: 'android' | 'ios', text: string, timeout?: number, deviceId?: string }) {
    const effectiveTimeout = timeout ?? 10000
    if (platform === 'android') {
      const resolved = await resolveTargetDevice({ platform: 'android', deviceId })
      return await new AndroidInteract().waitForElement(text, effectiveTimeout, resolved.id)
    } else {
      const resolved = await resolveTargetDevice({ platform: 'ios', deviceId })
      return await new iOSInteract().waitForElement(text, effectiveTimeout, resolved.id)
    }
  }

  static async tapHandler({ platform, x, y, deviceId }: { platform?: 'android' | 'ios', x: number, y: number, deviceId?: string }) {
    const effectivePlatform = platform || 'android'
    if (effectivePlatform === 'android') {
      const resolved = await resolveTargetDevice({ platform: 'android', deviceId })
      return await new AndroidInteract().tap(x, y, resolved.id)
    } else {
      const resolved = await resolveTargetDevice({ platform: 'ios', deviceId })
      return await new iOSInteract().tap(x, y, resolved.id)
    }
  }

  static async swipeHandler({ x1, y1, x2, y2, duration, deviceId }: { x1: number, y1: number, x2: number, y2: number, duration: number, deviceId?: string }) {
    const resolved = await resolveTargetDevice({ platform: 'android', deviceId })
    return await new AndroidInteract().swipe(x1, y1, x2, y2, duration, resolved.id)
  }

  static async typeTextHandler({ text, deviceId }: { text: string, deviceId?: string }) {
    const resolved = await resolveTargetDevice({ platform: 'android', deviceId })
    return await new AndroidInteract().typeText(text, resolved.id)
  }

  static async pressBackHandler({ deviceId }: { deviceId?: string }) {
    const resolved = await resolveTargetDevice({ platform: 'android', deviceId })
    return await new AndroidInteract().pressBack(resolved.id)
  }

}

