import { spawn } from "child_process"
import { promises as fs } from "fs"
import { GetLogsResponse, CaptureIOSScreenshotResponse, GetUITreeResponse, UIElement, DeviceInfo } from "../types.js"
import { execCommand, getIOSDeviceMetadata, validateBundleId, getIdbCmd, getXcrunCmd, isIDBInstalled } from "../utils/ios/utils.js"
import { createWriteStream, promises as fsPromises } from 'fs'
import path from 'path'
import { parseLogLine } from '../utils/android/utils.js'
import { computeScreenFingerprint } from '../interact/shared/fingerprint.js'

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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
  if (typeof frame === 'string') {
    const nums = frame.match(/-?\d+(?:\.\d+)?/g);
    if (!nums || nums.length < 4) return [0, 0, 0, 0];
    const x = Number(nums[0]);
    const y = Number(nums[1]);
    const w = Number(nums[2]);
    const h = Number(nums[3]);
    return [Math.round(x), Math.round(y), Math.round(x + w), Math.round(y + h)];
  }

  const x = Number(frame.x || 0);
  const y = Number(frame.y || 0);
  const w = Number(frame.width || frame.w || 0);
  const h = Number(frame.height || frame.h || 0);
  return [Math.round(x), Math.round(y), Math.round(x + w), Math.round(y + h)];
}

function getCenter(bounds: [number, number, number, number]): [number, number] {
  const [x1, y1, x2, y2] = bounds;
  return [Math.floor((x1 + x2) / 2), Math.floor((y1 + y2) / 2)];
}

function traverseIDBNode(node: IDBElement, elements: UIElement[], parentIndex: number = -1, depth: number = 0): number {
  if (!node) return -1;

  let currentIndex = -1;

  const type = node.AXElementType || node.type || "unknown";
  const label = node.AXLabel || node.label || null;
  const value = node.AXValue || null;
  const frame = node.AXFrame || node.frame;
  const traits = node.AXTraits || [];
  
  const clickable = traits.includes("UIAccessibilityTraitButton") || type === "Button" || type === "Cell";
  
  const isUseful = clickable || (label && label.length > 0) || (value && value.length > 0) || type === "Application" || type === "Window";

  if (isUseful) {
    const bounds = parseIDBFrame(frame);
    const element: UIElement = {
      text: label,
      contentDescription: value,
      type: type,
      resourceId: node.AXUniqueId || null,
      clickable: clickable,
      enabled: true,
      visible: true,
      bounds: bounds,
      center: getCenter(bounds),
      depth: depth
    };

    if (parentIndex !== -1) {
      element.parentId = parentIndex;
    }

    elements.push(element);
    currentIndex = elements.length - 1;
  }
  
  const nextParentIndex = currentIndex !== -1 ? currentIndex : parentIndex;
  const nextDepth = currentIndex !== -1 ? depth + 1 : depth;

  const childrenIndices: number[] = [];

  if (node.children && Array.isArray(node.children)) {
    for (const child of node.children) {
      const childIndex = traverseIDBNode(child, elements, nextParentIndex, nextDepth);
      if (childIndex !== -1) {
        childrenIndices.push(childIndex);
      }
    }
  }

  if (currentIndex !== -1 && childrenIndices.length > 0) {
    elements[currentIndex].children = childrenIndices;
  }

  return currentIndex;
}

const iosActiveLogStreams: Map<string, { proc: ReturnType<typeof import('child_process').spawn>, file: string }> = new Map()

export function _setIOSActiveLogStream(sessionId: string, file: string) {
  iosActiveLogStreams.set(sessionId, { proc: {} as any, file })
}

export function _clearIOSActiveLogStream(sessionId: string) {
  iosActiveLogStreams.delete(sessionId)
}

export class iOSObserve {
  async getDeviceMetadata(deviceId: string = "booted"): Promise<DeviceInfo> {
    return getIOSDeviceMetadata(deviceId);
  }

  async getLogs(appId?: string, deviceId: string = "booted"): Promise<GetLogsResponse> {
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
      await execCommand(['simctl', 'io', deviceId, 'screenshot', tmpFile], deviceId)
      
      const buffer = await fs.readFile(tmpFile)
      const base64 = buffer.toString('base64')
      
      await fs.rm(tmpFile).catch(() => {})

      return {
        device,
        screenshot: base64,
        resolution: { width: 0, height: 0 },
      }
    } catch (e) {
      await fs.rm(tmpFile).catch(() => {})
      throw new Error(`Failed to capture screenshot: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async getUITree(deviceId: string = "booted"): Promise<GetUITreeResponse> {
    const device = await getIOSDeviceMetadata(deviceId);
    
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

    const targetUdid = (device.id && device.id !== 'booted') ? device.id : undefined;

    let jsonContent: any = null;
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      attempts++;
      try {
         await delay(300 + (attempts * 100));

         const args = ['ui', 'describe-all', '--json'];
         if (targetUdid) {
            args.push('--udid', targetUdid);
         }

         const output = await new Promise<string>((resolve, reject) => {
             const child = spawn(getIdbCmd(), args);
             let stdout = '';
             let stderr = '';

             child.stdout.on('data', (data) => stdout += data.toString());
             child.stderr.on('data', (data) => stderr += data.toString());

             child.on('error', (err) => reject(new Error(`Failed to execute idb: ${err.message}`)));
             
             child.on('close', (code) => {
                 if (code !== 0) {
                     reject(new Error(`idb failed (code ${code}): ${stderr.trim()}`));
                 } else {
                     resolve(stdout);
                 }
             });
         });

         if (output && output.trim().length > 0) {
             jsonContent = JSON.parse(output);
             break; // Success
         }
      } catch (e) {
         console.error(`Attempt ${attempts} failed: ${e}`);
      }
      
      if (attempts === maxAttempts) {
          return {
              device,
              screen: "",
              resolution: { width: 0, height: 0 },
              elements: [],
              error: `Failed to retrieve valid UI dump after ${maxAttempts} attempts.`
          };
      }
    }

    try {
        const elements: UIElement[] = [];
        if (Array.isArray(jsonContent)) {
          for (const node of jsonContent) {
            traverseIDBNode(node, elements);
          }
        } else {
          traverseIDBNode(jsonContent, elements);
        }

        let width = 0;
        let height = 0;
        if (elements.length > 0) {
            const rootBounds = elements[0].bounds;
            width = rootBounds[2] - rootBounds[0];
            height = rootBounds[3] - rootBounds[1];
        }

        return {
            device,
            screen: "",
            resolution: { width, height },
            elements
        };
    } catch (e) {
         return {
            device,
            screen: "",
            resolution: { width: 0, height: 0 },
            elements: [],
            error: `Failed to parse idb output: ${e instanceof Error ? e.message : String(e)}`
         };
    }
  }

  async getScreenFingerprint(deviceId: string = 'booted'): Promise<{ fingerprint: string | null; activity?: string; error?: string }> {
    try {
      const tree = await this.getUITree(deviceId)
      if (!tree || tree.error) return { fingerprint: null, error: tree && (tree as any).error }

      return computeScreenFingerprint(tree, null, 'ios', 50)
    } catch (e) {
      return { fingerprint: null, error: e instanceof Error ? e.message : String(e) }
    }
  }

  async startLogStream(bundleId: string, deviceId: string = 'booted', sessionId: string = 'default') : Promise<{ success: boolean; stream_started?: boolean; error?: string }> {
    try {
      const predicate = `process == "${bundleId}" or subsystem contains "${bundleId}"`

      if (iosActiveLogStreams.has(sessionId)) {
        try { iosActiveLogStreams.get(sessionId)!.proc.kill() } catch {}
        iosActiveLogStreams.delete(sessionId)
      }

      const args = ['simctl', 'spawn', deviceId, 'log', 'stream', '--style', 'syslog', '--predicate', predicate]
      const proc = spawn(getXcrunCmd(), args)

      const tmpDir = process.env.TMPDIR || '/tmp'
      const file = path.join(tmpDir, `mobile-debug-ios-log-${sessionId}.ndjson`)
      const stream = createWriteStream(file, { flags: 'a' })

      proc.stdout.on('data', (chunk) => {
        const text = chunk.toString()
        const lines = text.split(/\r?\n/).filter(Boolean)
        for (const l of lines) {
          const entry = parseLogLine(l)
          stream.write(JSON.stringify(entry) + '\n')
        }
      })

      proc.stderr.on('data', (chunk) => {
        const text = chunk.toString()
        const lines = text.split(/\r?\n/).filter(Boolean)
        for (const l of lines) {
          const entry = { timestamp: '', level: 'E', tag: 'xcrun', message: l }
          stream.write(JSON.stringify(entry) + '\n')
        }
      })

      proc.on('close', () => {
        stream.end()
        iosActiveLogStreams.delete(sessionId)
      })

      iosActiveLogStreams.set(sessionId, { proc, file })
      return { success: true, stream_started: true }
    } catch {
      return { success: false, error: 'log_stream_start_failed' }
    }
  }

  async stopLogStream(sessionId: string = 'default'): Promise<{ success: boolean }> {
    const entry = iosActiveLogStreams.get(sessionId)
    if (!entry) return { success: true }
    try { entry.proc.kill() } catch {}
    iosActiveLogStreams.delete(sessionId)
    return { success: true }
  }

  async readLogStream(sessionId: string = 'default', limit: number = 100, since?: string): Promise<{ entries: any[], crash_summary?: { crash_detected: boolean, exception?: string, sample?: string } }> {
    const entry = iosActiveLogStreams.get(sessionId)
    if (!entry) return { entries: [] }
    try {
      const data = await fsPromises.readFile(entry.file, 'utf8').catch(() => '')
      if (!data) return { entries: [], crash_summary: { crash_detected: false } }
      const lines = data.split(/\r?\n/).filter(Boolean)
      const parsed = lines.map(l => {
        try {
          return JSON.parse(l)
        } catch {
          return { message: l, _iso: null, crash: false }
        }
      })

      let filtered = parsed
      if (since) {
        let sinceMs: number | null = null
        if (/^\d+$/.test(since)) sinceMs = Number(since)
        else {
          const sDate = new Date(since)
          if (!isNaN(sDate.getTime())) sinceMs = sDate.getTime()
        }
        if (sinceMs !== null) {
          filtered = parsed.filter(p => p._iso && (new Date(p._iso).getTime() >= sinceMs))
        }
      }

      const entries = filtered.slice(-Math.max(0, limit))
      const crashEntry = entries.find(e => e.crash)
      const crash_summary = crashEntry ? { crash_detected: true, exception: crashEntry.exception, sample: crashEntry.message } : { crash_detected: false }
      return { entries, crash_summary }
    } catch {
      return { entries: [], crash_summary: { crash_detected: false } }
    }
  }
}
