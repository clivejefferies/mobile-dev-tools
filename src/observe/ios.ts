import { spawn } from "child_process"
import { promises as fs } from "fs"
import { GetLogsResponse, CaptureIOSScreenshotResponse, GetUITreeResponse, UIElement, DeviceInfo } from "../types.js"
import { execCommand, getIOSDeviceMetadata, validateBundleId, getIdbCmd, getXcrunCmd, isIDBInstalled } from "../utils/ios/utils.js"
import { createWriteStream, promises as fsPromises } from 'fs'
import path from 'path'
import { parseLogLine } from '../utils/android/utils.js'
import { computeScreenFingerprint } from '../utils/ui/index.js'
import { parsePngSize } from '../utils/image.js'

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

  async getLogs(filters: { appId?: string, deviceId?: string, pid?: number, tag?: string, level?: string, contains?: string, since_seconds?: number, limit?: number } = {}): Promise<GetLogsResponse> {
    const { appId, deviceId = 'booted', pid, tag, level, contains, since_seconds, limit } = filters
    const args: string[] = ['simctl', 'spawn', deviceId, 'log', 'show', '--style', 'syslog']

    // Default to last N seconds if no since_seconds provided; limit lines handled after parsing
    const effectiveLimit = typeof limit === 'number' && limit > 0 ? limit : 50

    if (since_seconds) {
      // log show accepts --last <time>
      args.push('--last', `${since_seconds}s`)
    } else {
      // default to last 60s to keep quick
      args.push('--last', '60s')
    }

    if (appId) {
      validateBundleId(appId)
      // constrain to subsystem or process matching appId
      args.push('--predicate', `subsystem contains "${appId}" or process == "${appId}"`)
    } else if (tag) {
      // predicate by subsystem/category
      args.push('--predicate', `subsystem contains "${tag}"`)
    }

    try {
      const result = await execCommand(args, deviceId)
      const device = await getIOSDeviceMetadata(deviceId)
      const rawLines = result.output ? result.output.split(/\r?\n/).filter(Boolean) : []

      // Parse lines into structured entries. iOS log format: timestamp [PID:tid] <level> subsystem:category: message
      const parsed = rawLines.map(line => {
        // Example: 2023-08-12 12:34:56.789012+0000  pid  <Debug>  MyApp[123:456]  <info>  MySubsystem: MyCategory: Message here
        // Simpler approach: try to extract ISO timestamp at start
        let ts: string | null = null
        const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?)/)
        if (tsMatch) {
          const d = new Date(tsMatch[1])
          if (!isNaN(d.getTime())) ts = d.toISOString()
        }

        // level mapping
        let lvl = 'INFO'
        const lvlMatch = line.match(/\b(Debug|Info|Default|Error|Fault|Warning)\b/i)
        if (lvlMatch) {
          const map: Record<string, string> = { 'debug': 'DEBUG', 'info': 'INFO', 'default': 'DEBUG', 'error': 'ERROR', 'fault': 'ERROR', 'warning': 'WARN' }
          lvl = map[(lvlMatch[1] || '').toLowerCase()] || 'INFO'
        }

        // subsystem/category -> tag
        let tagVal = ''
        const tagMatch = line.match(/\s([A-Za-z0-9_./-]+):\s/)
        if (tagMatch) tagVal = tagMatch[1]

        // pid extraction
        let pidNum: number | null = null
        const pidMatch = line.match(/\[(\d+):\d+\]/)
        if (pidMatch) pidNum = Number(pidMatch[1])

        // message: extract robustly after the subsystem/category token when available
        let message = line
        if (tagMatch) {
          // tagMatch[0] includes the delimiter (e.g. " MySubsystem: ") — use it to find the message start
          const marker = tagMatch[0]
          const idx = line.indexOf(marker)
          if (idx !== -1) {
            message = line.slice(idx + marker.length).trim()
          } else {
            // fallback: try to trim off common prefixes (timestamp, pid, level) and keep the rest
            const afterPidMatch = line.match(/\]\s+/)
            if (afterPidMatch) {
              const afterPidIdx = line.indexOf(afterPidMatch[0]) + afterPidMatch[0].length
              message = line.slice(afterPidIdx).trim()
            } else {
              // remove leading level tokens like <Debug> and keep remainder
              message = line.replace(/^.*?<.*?>\s*/,'').trim()
            }
          }
        } else {
          // No tag found — strip obvious prefixes and keep remainder (preserve colons in message)
          message = line.replace(/^.*?<.*?>\s*/,'').trim()
        }

        return { timestamp: ts, level: lvl, tag: tagVal, pid: pidNum, message }
      })

      // Apply contains filter
      let filtered = parsed
      if (contains) filtered = filtered.filter(e => e.message && e.message.includes(contains))

      // Apply since_seconds already applied by log show, but double-check timestamps
      if (since_seconds) {
        const sinceMs = Date.now() - (since_seconds * 1000)
        filtered = filtered.filter(e => e.timestamp && (new Date(e.timestamp).getTime() >= sinceMs))
      }

      // level filter
      if (level) {
        const L = level.toUpperCase()
        filtered = filtered.filter(e => e.level && e.level.toUpperCase() === L)
      }

      // tag filter
      if (tag) filtered = filtered.filter(e => e.tag && e.tag.includes(tag))

      // pid filter
      if (pid) filtered = filtered.filter(e => e.pid === pid)

      // If appId present but no predicate returned lines, try substring match
      if (appId && filtered.length === 0) {
        const matched = parsed.filter(e => (e.message && e.message.includes(appId)) || (e.tag && e.tag.includes(appId)))
        if (matched.length > 0) filtered = matched
      }

      // Order oldest -> newest
      filtered.sort((a,b) => {
        const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0
        const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0
        return ta - tb
      })

      const limited = filtered.slice(-Math.max(0, effectiveLimit))
      return { device, logs: limited, logCount: limited.length }
    } catch (err) {
      console.error('iOS getLogs failed:', err)
      const device = await getIOSDeviceMetadata(deviceId)
      return { device, logs: [], logCount: 0 }
    }
  }

  async captureScreenshot(deviceId: string = "booted"): Promise<CaptureIOSScreenshotResponse> {
    const device = await getIOSDeviceMetadata(deviceId)
    const tmpFile = `/tmp/mcp-ios-screenshot-${Date.now()}.png`

    try {
      await execCommand(['simctl', 'io', deviceId, 'screenshot', tmpFile], deviceId)
      
      const buffer = await fs.readFile(tmpFile)
      const base64 = buffer.toString('base64')

      const dims = parsePngSize(buffer)

      // Try to generate WebP (preferred) and JPEG fallback using sharp (in-process, cross-platform)
      try {
        const sharpModule = await import('sharp'); const sharp = sharpModule && (sharpModule as any).default ? (sharpModule as any).default : sharpModule;
        const img = sharp(buffer);
        const meta = await img.metadata().catch((err: any) => { console.error('sharp.metadata failed:', err); return {} as any });

        // If image has alpha channel, prefer lossless PNG to preserve transparency
        const hasAlpha = !!meta.hasAlpha || (meta.channels && meta.channels > 3);

        // Generate WebP and JPEG buffers; log failures
        let webpBuf: Buffer | null = null;
        let jpegBuf: Buffer | null = null;
        try {
          webpBuf = await img.webp({ quality: 80 }).toBuffer();
        } catch (err) {
          console.error('WebP conversion failed (iOS):', err instanceof Error ? err.message : String(err));
          webpBuf = null;
        }
        try {
          jpegBuf = await img.jpeg({ quality: 80 }).toBuffer();
        } catch (err) {
          console.error('JPEG conversion failed (iOS):', err instanceof Error ? err.message : String(err));
          jpegBuf = null;
        }

        await fs.rm(tmpFile).catch(() => {});

        if (hasAlpha) {
          // preserve alpha: return PNG if WebP not available
          if (webpBuf) {
            return { device, screenshot: webpBuf.toString('base64'), screenshot_mime: 'image/webp', screenshot_fallback: base64, screenshot_fallback_mime: 'image/png', resolution: { width: dims.width, height: dims.height } }
          }
          // if webp unavailable, return original PNG
          return { device, screenshot: base64, screenshot_mime: 'image/png', resolution: { width: dims.width, height: dims.height } }
        }

        // No alpha: prefer webp, fall back to jpeg
        if (webpBuf) {
          return { device, screenshot: webpBuf.toString('base64'), screenshot_mime: 'image/webp', screenshot_fallback: jpegBuf ? jpegBuf.toString('base64') : undefined, screenshot_fallback_mime: jpegBuf ? 'image/jpeg' : undefined, resolution: { width: dims.width, height: dims.height } }
        }
        if (jpegBuf) {
          return { device, screenshot: jpegBuf.toString('base64'), screenshot_mime: 'image/jpeg', resolution: { width: dims.width, height: dims.height } }
        }
      } catch (err) {
        console.error('Screenshot conversion pipeline failed (iOS):', err instanceof Error ? err.message : String(err));
        // fall through to png fallback
      }

      await fs.rm(tmpFile).catch(() => {})
      return {
        device,
        screenshot: base64,
        screenshot_mime: 'image/png',
        resolution: { width: dims.width, height: dims.height },
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
