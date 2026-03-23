import { WaitForElementResponse, TapResponse, SwipeResponse, TypeTextResponse, PressBackResponse } from "../types.js"
import { execAdb, getAndroidDeviceMetadata, getDeviceInfo } from "../utils/android/utils.js"
import { AndroidObserve } from "../observe/index.js"
import { scrollToElementShared } from "../interact/shared/scroll_to_element.js"


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
    return await scrollToElementShared({
      selector,
      direction,
      maxScrolls,
      scrollAmount,
      deviceId,
      fetchTree: async () => await this.observe.getUITree(deviceId),
      swipe: async (x1: number, y1: number, x2: number, y2: number, duration: number, devId?: string) => await this.swipe(x1, y1, x2, y2, duration, devId)
    })
  }

}
