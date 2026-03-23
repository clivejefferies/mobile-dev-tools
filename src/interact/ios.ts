import { spawn } from "child_process"
import { WaitForElementResponse, TapResponse, SwipeResponse } from "../types.js"
import { getIOSDeviceMetadata, getIdbCmd, isIDBInstalled } from "../utils/ios/utils.js"
import { iOSObserve } from "../observe/index.js"
import { scrollToElementShared } from "../interact/shared/scroll_to_element.js"

export class iOSInteract {
  private observe = new iOSObserve();

  async waitForElement(text: string, timeout: number, deviceId: string = "booted"): Promise<WaitForElementResponse> {
    const device = await getIOSDeviceMetadata(deviceId);
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      try {
        const tree = await this.observe.getUITree(deviceId);
        
        if (tree.error) {
          return { device, found: false, error: tree.error };
        }

        const element = tree.elements.find(e => e.text === text);
        if (element) {
          return { device, found: true, element };
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
    return { device, found: false };
  }

  async tap(x: number, y: number, deviceId: string = "booted"): Promise<TapResponse> {
    const device = await getIOSDeviceMetadata(deviceId)
    
    // Use shared helper to detect idb
    const idbExists = await isIDBInstalled();

    if (!idbExists) {
        return {
            device,
            success: false,
            x,
            y,
            error: "iOS tap requires 'idb' (iOS Device Bridge)."
        }
    }

    try {
      const targetUdid = (device.id && device.id !== 'booted') ? device.id : undefined;
      const args = ['ui', 'tap', x.toString(), y.toString()];
      if (targetUdid) {
        args.push('--udid', targetUdid);
      }

      await new Promise<void>((resolve, reject) => {
        const proc = spawn(getIdbCmd(), args);
        let stderr = '';
        proc.stderr.on('data', d => stderr += d.toString());
        proc.on('close', code => {
            if (code === 0) resolve();
            else reject(new Error(`idb ui tap failed: ${stderr}`));
        });
        proc.on('error', err => reject(err));
      });

      return { device, success: true, x, y };
    } catch (e) {
      return { device, success: false, x, y, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async swipe(x1: number, y1: number, x2: number, y2: number, duration: number, deviceId: string = "booted"): Promise<SwipeResponse> {
    const device = await getIOSDeviceMetadata(deviceId);
    // Use shared helper to detect idb
    const idbExists = await isIDBInstalled();

    if (!idbExists) {
      return {
        device,
        success: false,
        start: [x1, y1],
        end: [x2, y2],
        duration,
        error: "iOS swipe requires 'idb' (iOS Device Bridge)."
      }
    }

    try {
      const targetUdid = (device.id && device.id !== 'booted') ? device.id : undefined;
      // idb 'ui swipe' does not accept a duration parameter; use coordinates only
      const args: string[] = ['ui', 'swipe', x1.toString(), y1.toString(), x2.toString(), y2.toString()];
      if (targetUdid) {
        args.push('--udid', targetUdid);
      }

      await new Promise<void>((resolve, reject) => {
        const proc = spawn(getIdbCmd(), args);
        let stderr = '';
        proc.stderr.on('data', d => stderr += d.toString());
        proc.on('close', code => {
          if (code === 0) resolve();
          else reject(new Error(`idb ui swipe failed: ${stderr}`));
        });
        proc.on('error', err => reject(err));
      });

      return { device, success: true, start: [x1, y1], end: [x2, y2], duration };
    } catch (e) {
      return { device, success: false, start: [x1, y1], end: [x2, y2], duration, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async scrollToElement(selector: { text?: string, resourceId?: string, contentDesc?: string, className?: string }, direction: 'down' | 'up' = 'down', maxScrolls = 10, scrollAmount = 0.7, deviceId: string = 'booted') {
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

