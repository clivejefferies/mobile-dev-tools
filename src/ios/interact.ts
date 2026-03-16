import { spawn } from "child_process"
import { WaitForElementResponse, TapResponse } from "../types.js"
import { getIOSDeviceMetadata, IDB } from "./utils.js"
import { iOSObserve } from "./observe.js"

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
    
    // Check for idb
    const child = spawn(IDB, ['--version']);
    const idbExists = await new Promise<boolean>((resolve) => {
      child.on('error', () => resolve(false));
      child.on('close', (code) => resolve(code === 0));
    });

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
        const proc = spawn(IDB, args);
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
}
