import { spawn } from "child_process"
import { promises as fs } from "fs"
import { GetLogsResponse, CaptureIOSScreenshotResponse, GetUITreeResponse, UIElement, DeviceInfo } from "../types.js"
import { execCommand, getIOSDeviceMetadata, validateBundleId, IDB } from "./utils.js"

// --- Helper Functions Specific to Observe ---

interface IDBElement {
  AXFrame?: { x: number | string, y: number | string, width: number | string, height: number | string, w?: number | string, h?: number | string };
  frame?: { x: number | string, y: number | string, width: number | string, height: number | string, w?: number | string, h?: number | string };
  AXUniqueId?: string;
  AXLabel?: string;
  AXValue?: string;
  AXTraits?: string[];
  AXElementType?: string;
  type?: string;
  label?: string;
  children?: IDBElement[];
}

function parseIDBFrame(frame: any): [number, number, number, number] {
  if (!frame) return [0, 0, 0, 0];
  const x = Number(frame.x || 0);
  const y = Number(frame.y || 0);
  const w = Number(frame.width || frame.w || 0);
  const h = Number(frame.height || frame.h || 0);
  return [Math.round(x), Math.round(y), Math.round(x + w), Math.round(y + h)];
}

function traverseIDBNode(node: IDBElement, elements: UIElement[], parentIndex: number = -1): number {
  if (!node) return -1;

  // Prefer standard keys, fallback to alternatives
  const type = node.AXElementType || node.type || "unknown";
  const label = node.AXLabel || node.label || null;
  const value = node.AXValue || null;
  const frame = node.AXFrame || node.frame;
  
  const element: UIElement = {
    text: label,
    contentDescription: value, // iOS uses Value/Label differently than Android but this maps roughly
    type: type,
    resourceId: node.AXUniqueId || null,
    clickable: (node.AXTraits || []).includes("UIAccessibilityTraitButton") || type === "Button",
    enabled: true, // idb usually returns enabled elements
    visible: true,
    bounds: parseIDBFrame(frame),
  };

  if (parentIndex !== -1) {
    element.parentId = parentIndex;
  }

  elements.push(element);
  const currentIndex = elements.length - 1;
  const childrenIndices: number[] = [];

  if (node.children && Array.isArray(node.children)) {
    for (const child of node.children) {
      const childIndex = traverseIDBNode(child, elements, currentIndex);
      if (childIndex !== -1) {
        childrenIndices.push(childIndex);
      }
    }
  }

  if (childrenIndices.length > 0) {
    elements[currentIndex].children = childrenIndices;
  }

  return currentIndex;
}

// Check if IDB is installed
async function isIDBInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(IDB, ['--version']);
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

export class iOSObserve {
  async getDeviceMetadata(deviceId: string = "booted"): Promise<DeviceInfo> {
    return getIOSDeviceMetadata(deviceId);
  }

  async getLogs(appId?: string, deviceId: string = "booted"): Promise<GetLogsResponse> {
    // If appId is provided, use predicate filtering
    // Note: execFile passes args directly, so we don't need shell escaping for the predicate string itself,
    // but we do need to construct the predicate correctly for log show.
    const args = ['simctl', 'spawn', deviceId, 'log', 'show', '--style', 'syslog', '--last', '1m']
    if (appId) {
      validateBundleId(appId)
      args.push('--predicate', `subsystem contains "${appId}" or process == "${appId}"`)
    }
    
    const result = await execCommand(args, deviceId)
    const device = await getIOSDeviceMetadata(deviceId)
    const logs = result.output ? result.output.split('\n') : []
    return {
      device,
      logs,
      logCount: logs.length,
    }
  }

  async captureScreenshot(deviceId: string = "booted"): Promise<CaptureIOSScreenshotResponse> {
    const device = await getIOSDeviceMetadata(deviceId)
    const tmpFile = `/tmp/mcp-ios-screenshot-${Date.now()}.png`

    try {
      // 1. Capture screenshot to temp file
      await execCommand(['simctl', 'io', deviceId, 'screenshot', tmpFile], deviceId)
      
      // 2. Read file as base64
      const buffer = await fs.readFile(tmpFile)
      const base64 = buffer.toString('base64')
      
      // 3. Clean up
      await fs.rm(tmpFile).catch(() => {})

      return {
        device,
        screenshot: base64,
        // Default resolution since we can't easily parse it without extra libs
        // Clients will read the real dimensions from the PNG header anyway
        resolution: { width: 0, height: 0 },
      }
    } catch (err) {
      // Ensure cleanup happens even on error
      await fs.rm(tmpFile).catch(() => {})
      throw new Error(`Failed to capture screenshot: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async getUITree(deviceId: string = "booted"): Promise<GetUITreeResponse> {
    const device = await getIOSDeviceMetadata(deviceId);
    
    // idb is required
    const idbExists = await isIDBInstalled();
    if (!idbExists) {
       return {
          device,
          screen: "",
          resolution: { width: 0, height: 0 },
          elements: [],
          error: "iOS UI tree retrieval requires 'idb' (iOS Device Bridge). Please install it via Homebrew: `brew tap facebook/fb && brew install idb-companion` and `pip3 install fb-idb`."
       };
    }

    return new Promise((resolve) => {
      // idb ui describe --udid <uuid> --json
      // If deviceId is 'booted', try to resolve it to a UDID because idb often needs explicit target
      const targetUdid = (device.id && device.id !== 'booted') ? device.id : undefined;
      
      const args = ['ui', 'describe', '--json'];
      if (targetUdid) {
          args.push('--udid', targetUdid);
      }

      const child = spawn(IDB, args);
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => stdout += data.toString());
      child.stderr.on('data', (data) => stderr += data.toString());

      child.on('error', (err) => {
           resolve({
              device,
              screen: "",
              resolution: { width: 0, height: 0 },
              elements: [],
              error: `Failed to execute idb: ${err.message}`
           });
      });

      child.on('close', (code) => {
          if (code !== 0) {
               resolve({
                  device,
                  screen: "",
                  resolution: { width: 0, height: 0 },
                  elements: [],
                  error: `idb failed (code ${code}): ${stderr.trim()}`
               });
               return;
          }

          try {
              const json = JSON.parse(stdout);
              const elements: UIElement[] = [];
              
              // idb return object usually has 'children' at root or is the root
              const root = json; 
              
              traverseIDBNode(root, elements);

              // Infer resolution from root element if possible (usually the Window/Application frame)
              let width = 0;
              let height = 0;
              if (elements.length > 0) {
                  const rootBounds = elements[0].bounds;
                  width = rootBounds[2] - rootBounds[0];
                  height = rootBounds[3] - rootBounds[1];
              }

              resolve({
                  device,
                  screen: "",
                  resolution: { width, height },
                  elements
              });
          } catch (e) {
               resolve({
                  device,
                  screen: "",
                  resolution: { width: 0, height: 0 },
                  elements: [],
                  error: `Failed to parse idb output: ${e instanceof Error ? e.message : String(e)}`
               });
          }
      });
    });
  }
}
