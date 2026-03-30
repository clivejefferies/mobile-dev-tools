import { spawn } from "child_process"
import { XMLParser } from "fast-xml-parser"
import { GetLogsResponse, CaptureAndroidScreenResponse, GetUITreeResponse, GetCurrentScreenResponse, UIElement, DeviceInfo } from "../types.js"
import { getAdbCmd, execAdb, getAndroidDeviceMetadata, getDeviceInfo, delay, getScreenResolution, traverseNode, parseLogLine } from "../utils/android/utils.js"
import { createWriteStream } from "fs"
import { promises as fsPromises } from "fs"
import path from "path"
import { computeScreenFingerprint } from "../utils/ui/index.js"
import { parsePngSize } from "../utils/image.js"

const activeLogStreams: Map<string, { proc: any, file: string }> = new Map()

export class AndroidObserve {
  async getDeviceMetadata(appId: string, deviceId?: string): Promise<DeviceInfo> {
    return getAndroidDeviceMetadata(appId, deviceId);
  }

  async getUITree(deviceId?: string): Promise<GetUITreeResponse> {
    const metadata = await getAndroidDeviceMetadata("", deviceId)
    const deviceInfo = getDeviceInfo(deviceId || 'default', metadata)

    try {
      // Get screen resolution first
      const resolution = await getScreenResolution(deviceId);
      if (resolution.width === 0 && resolution.height === 0) {
          throw new Error("Failed to get screen resolution. Is the device connected and authorized?");
      }

      // Retry Logic
      let xmlContent = '';
      let attempts = 0;
      const maxAttempts = 3;

      while (attempts < maxAttempts) {
        attempts++;
        try {
           // Stabilization delay
           await delay(300 + (attempts * 100)); // 300ms, 400ms, 500ms...

           // Dump UI hierarchy
           await execAdb(['shell', 'uiautomator', 'dump', '/sdcard/ui.xml'], deviceId);
           
           // Read the file
           xmlContent = await execAdb(['shell', 'cat', '/sdcard/ui.xml'], deviceId);
           
           // Check validity
           if (xmlContent && xmlContent.trim().length > 0 && !xmlContent.includes("ERROR:")) {
              break; // Success
           }
        } catch (e) {
           console.error(`Attempt ${attempts} failed: ${e}`);
        }
        
        if (attempts === maxAttempts) {
           throw new Error(`Failed to retrieve valid UI dump after ${maxAttempts} attempts.`);
        }
      }

      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_"
      });
      const result = parser.parse(xmlContent);
      
      const elements: UIElement[] = [];
      
      // The root is usually hierarchy -> node
      if (result.hierarchy && result.hierarchy.node) {
          // If the root is an array (unlikely for root, but good to be safe) or single object
          if (Array.isArray(result.hierarchy.node)) {
             result.hierarchy.node.forEach((n: any) => traverseNode(n, elements));
          } else {
             traverseNode(result.hierarchy.node, elements);
          }
      }

      return {
        device: deviceInfo,
        screen: "",
        resolution,
        elements
      };
    } catch (e) {
      const errorMessage = `Failed to get UI tree. ADB Path: '${getAdbCmd()}'. Error: ${e instanceof Error ? e.message : String(e)}`;
      console.error(errorMessage);
      return {
          device: deviceInfo,
          screen: "",
          resolution: { width: 0, height: 0 },
          elements: [],
          error: errorMessage
      };
    }
  }

  async getLogs(filters: { appId?: string, deviceId?: string, pid?: number, tag?: string, level?: string, contains?: string, since_seconds?: number, limit?: number } = {}): Promise<GetLogsResponse> {
    const { appId, deviceId, pid, tag, level, contains, since_seconds, limit } = filters
    const metadata = await getAndroidDeviceMetadata(appId || "", deviceId)
    const deviceInfo = getDeviceInfo(deviceId || 'default', metadata)

    try {
      const effectiveLimit = typeof limit === 'number' && limit > 0 ? limit : 50

      // If appId provided, try to get pid to filter at source
      let pidArg: string | null = null
      if (appId) {
        try {
          const pidOut = await execAdb(['shell', 'pidof', appId], deviceId).catch(() => '')
          const pidTrim = (pidOut || '').trim()
          if (pidTrim) pidArg = pidTrim.split('\n')[0]
        } catch (err) {
          // Log a warning so failures to detect PID are visible during debugging
          try { console.warn(`getLogs: pid detection failed for appId=${appId}:`, err instanceof Error ? err.message : String(err)) } catch { }
        }
      }

      const args = ['logcat', '-d', '-v', 'threadtime']
      // Apply pid filter via --pid if available
      if (pidArg) args.push(`--pid=${pidArg}`)
      else if (pid) args.push(`--pid=${pid}`)

      // Apply tag/level filter if provided
      if (tag && level) {
        // Map verbose/debug/info/warn/error to single-letter levels
        const levelMap: Record<string, string> = { 'VERBOSE': 'V', 'DEBUG': 'D', 'INFO': 'I', 'WARN': 'W', 'ERROR': 'E' }
        const L = (levelMap[(level || '').toUpperCase()] || 'V')
        args.push(`${tag}:${L}`)
      } else {
        // Default: show all levels
        args.push('*:V')
      }

      // Use -t to limit lines (apply early)
      args.push('-t', effectiveLimit.toString())

      const stdout = await execAdb(args, deviceId)
      const allLines = stdout ? stdout.split(/\r?\n/).filter(Boolean) : []

      // Parse lines into structured entries
      const parsed = allLines.map(l => {
        const entry = parseLogLine(l)
        // normalize level
        const levelChar = (entry.level || '').toUpperCase()
        const levelMapChar: Record<string,string> = { 'V':'VERBOSE','D':'DEBUG','I':'INFO','W':'WARN','E':'ERROR' }
        const normLevel = levelMapChar[levelChar] || (entry.level && String(entry.level).toUpperCase()) || 'INFO'
        const iso = entry._iso || (() => {
          const d = new Date(entry.timestamp || '')
          if (!isNaN(d.getTime())) return d.toISOString()
          return null
        })()
        let pidNum: number | null = null
        if (entry.pid) pidNum = Number(entry.pid)
        else if (pidArg) pidNum = Number(pidArg)
        const pidVal = (pidNum !== null && !isNaN(pidNum)) ? pidNum : null
        return { timestamp: iso, level: normLevel, tag: entry.tag || '', pid: pidVal, message: entry.message || '' }
      })

      // Apply client-side filters: contains, since_seconds
      let filtered = parsed
      if (contains) filtered = filtered.filter(e => e.message && e.message.includes(contains))

      if (since_seconds) {
        const sinceMs = Date.now() - (since_seconds * 1000)
        filtered = filtered.filter(e => {
          if (!e.timestamp) return false
          const t = new Date(e.timestamp).getTime()
          return t >= sinceMs
        })
      }

      // If appId provided and no pidArg, try to filter by appId substring in message/tag
      if (appId && !pidArg) {
        const matched = filtered.filter(e => (e.message && e.message.includes(appId)) || (e.tag && e.tag.includes(appId)))
        if (matched.length > 0) filtered = matched
      }

      // Ensure ordering oldest -> newest (by timestamp when available)
      filtered.sort((a,b) => {
        const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0
        const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0
        return ta - tb
      })

      const limited = filtered.slice(-Math.max(0, effectiveLimit))

      return { device: deviceInfo, logs: limited, logCount: limited.length }
    } catch (e) {
      console.error("Error fetching logs:", e)
      return { device: deviceInfo, logs: [], logCount: 0 }
    }
  }

  async captureScreen(deviceId?: string): Promise<CaptureAndroidScreenResponse> {
    const metadata = await getAndroidDeviceMetadata("", deviceId)
    const deviceInfo: DeviceInfo = getDeviceInfo(deviceId || 'default', metadata)

    return new Promise((resolve, reject) => {
      const args = deviceId ? ['-s', deviceId, 'exec-out', 'screencap', '-p'] : ['exec-out', 'screencap', '-p'];
      const child = spawn(getAdbCmd(), args)
      
      const chunks: Buffer[] = []
      let stderr = ''

      child.stdout.on('data', (chunk) => {
        chunks.push(Buffer.from(chunk))
      })

      child.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`ADB screencap timed out after 10s`))
      }, 10000)

      child.on('close', async (code) => {
        clearTimeout(timeout)
        if (code !== 0) {
          reject(new Error(stderr.trim() || `Screencap failed with code ${code}`))
          return
        }

        const screenshotBuffer = Buffer.concat(chunks)
        const screenshotBase64 = screenshotBuffer.toString('base64')

        const parsed = parsePngSize(screenshotBuffer)
        if (parsed.width > 0 && parsed.height > 0) {
          // Attempt to convert to WebP (preferred) and provide JPEG fallback (awaited to avoid race)
          try {
            const sharpModule = await import('sharp'); const sharp = sharpModule && (sharpModule as any).default ? (sharpModule as any).default : sharpModule;
            const buf = screenshotBuffer;
            const img = sharp(buf);
            const meta = await img.metadata().catch((err: any) => { console.error('sharp.metadata failed (Android):', err); return {} as any });
            const hasAlpha = !!meta.hasAlpha || (meta.channels && meta.channels > 3);

            let webpBuf: Buffer | null = null;
            let jpegBuf: Buffer | null = null;
            try {
              webpBuf = await img.webp({ quality: 80 }).toBuffer();
            } catch (err) {
              console.error('WebP conversion failed (Android):', err instanceof Error ? err.message : String(err));
              webpBuf = null;
            }
            try {
              jpegBuf = await img.jpeg({ quality: 80 }).toBuffer();
            } catch (err) {
              console.error('JPEG conversion failed (Android):', err instanceof Error ? err.message : String(err));
              jpegBuf = null;
            }

            if (hasAlpha) {
              if (webpBuf) {
                const webpB64 = webpBuf.toString('base64')
                const jpegB64 = jpegBuf ? jpegBuf.toString('base64') : null
                resolve({ device: deviceInfo, screenshot: webpB64, screenshot_mime: 'image/webp', screenshot_fallback: jpegB64, screenshot_fallback_mime: jpegB64 ? 'image/jpeg' : undefined, resolution: { width: parsed.width, height: parsed.height } } as any)
                return
              }
              const pngB64 = buf.toString('base64')
              resolve({ device: deviceInfo, screenshot: pngB64, screenshot_mime: 'image/png', resolution: { width: parsed.width, height: parsed.height } })
              return
            }

            if (webpBuf) {
              const webpB64 = webpBuf.toString('base64')
              const jpegB64 = jpegBuf ? jpegBuf.toString('base64') : null
              resolve({ device: deviceInfo, screenshot: webpB64, screenshot_mime: 'image/webp', screenshot_fallback: jpegB64, screenshot_fallback_mime: jpegB64 ? 'image/jpeg' : undefined, resolution: { width: parsed.width, height: parsed.height } } as any)
              return
            }

            if (jpegBuf) {
              resolve({ device: deviceInfo, screenshot: jpegBuf.toString('base64'), screenshot_mime: 'image/jpeg', resolution: { width: parsed.width, height: parsed.height } })
              return
            }

            // No conversions succeeded; return original PNG
            resolve({ device: deviceInfo, screenshot: screenshotBase64, screenshot_mime: 'image/png', resolution: { width: parsed.width, height: parsed.height } })
            return
          } catch (err) {
            console.error('Screenshot conversion pipeline failed (Android):', err instanceof Error ? err.message : String(err));
            // Conversion failed - fall back to original PNG with parsed resolution
            resolve({ device: deviceInfo, screenshot: screenshotBase64, screenshot_mime: 'image/png', resolution: { width: parsed.width, height: parsed.height } })
            return
          }
        } else {
          // Fallback to querying wm size if parsing failed
          execAdb(['shell', 'wm', 'size'], deviceId)
            .then(sizeStdout => {
              let width = 0
              let height = 0
              const match = sizeStdout.match(/Physical size: (\d+)x(\d+)/)
              if (match) {
                width = parseInt(match[1], 10)
                height = parseInt(match[2], 10)
              }
              resolve({
                device: deviceInfo,
                screenshot: screenshotBase64,
                screenshot_mime: 'image/png',
                resolution: { width, height }
              })
            })
            .catch(() => {
               resolve({
                device: deviceInfo,
                screenshot: screenshotBase64,
                screenshot_mime: 'image/png',
                resolution: { width: 0, height: 0 }
              })
            })
        }
      })

      child.on('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })
    })
  }

  async getCurrentScreen(deviceId?: string): Promise<GetCurrentScreenResponse> {
    const metadata = await getAndroidDeviceMetadata("", deviceId)
    const deviceInfo = getDeviceInfo(deviceId || 'default', metadata)

    try {
      const output = await execAdb(['shell', 'dumpsys', 'activity', 'activities'], deviceId, { timeout: 10000 })
      const lines = output.split('\n');
      let resumedLine = lines.find(line => /^\s*mResumedActivity:/.test(line));
      
      if (!resumedLine) {
        resumedLine = lines.find(line => /^\s*ResumedActivity:/.test(line));
      }

      if (!resumedLine) {
         return {
            device: deviceInfo,
            package: "",
            activity: "",
            shortActivity: "",
            error: "Could not find 'mResumedActivity' in dumpsys output"
         }
      }

      const match = resumedLine.match(/ActivityRecord\{[^ ]*(?:\s+[^ ]+)*\s+([^\/ ]+)\/([^ \{}]+)[^}]*\}/);

      if (match) {
        const packageName = match[1];
        let activityName = match[2];
        
        if (activityName.startsWith('.')) {
          activityName = packageName + activityName;
        }
        
        const shortActivity = activityName.split('.').pop() || activityName;

        return {
          device: deviceInfo,
          package: packageName,
          activity: activityName,
          shortActivity: shortActivity
        };
      } else {
         return {
            device: deviceInfo,
            package: "",
            activity: "",
            shortActivity: "",
            error: `Found resumed activity line but failed to parse: '${resumedLine.trim()}'`
         }
      }

    } catch (e) {
      return {
          device: deviceInfo,
          package: "",
          activity: "",
          shortActivity: "",
          error: e instanceof Error ? e.message : String(e)
      };
    }
  }

  async getScreenFingerprint(deviceId?: string): Promise<{ fingerprint: string | null; activity?: string; error?: string }> {
    try {
      const tree = await this.getUITree(deviceId)
      if (!tree || (tree as any).error) return { fingerprint: null, error: (tree as any).error }

      const current = await this.getCurrentScreen(deviceId).catch(() => null)
      return computeScreenFingerprint(tree, current, 'android', 50)
    } catch (e) {
      return { fingerprint: null, error: e instanceof Error ? e.message : String(e) }
    }
  }

  async startLogStream(packageName: string, level: 'error' | 'warn' | 'info' | 'debug' = 'error', deviceId?: string, sessionId: string = 'default') {
    try {
      const pidOutput = await execAdb(['shell', 'pidof', packageName], deviceId).catch(() => '')
      const pid = (pidOutput || '').trim()
      if (!pid) return { success: false, error: 'app_not_running' }

      const levelMap: Record<string, string> = { error: '*:E', warn: '*:W', info: '*:I', debug: '*:D' }
      const filter = levelMap[level] || levelMap['error']

      if (activeLogStreams.has(sessionId)) {
        try { activeLogStreams.get(sessionId)!.proc.kill() } catch {}
        activeLogStreams.delete(sessionId)
      }

      const args = ['logcat', `--pid=${pid}`, filter]
      const proc = spawn(getAdbCmd(), args)

      const tmpDir = process.env.TMPDIR || '/tmp'
      const file = path.join(tmpDir, `mobile-debug-log-${sessionId}.ndjson`)
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
          const entry = { timestamp: '', level: 'E', tag: 'adb', message: l }
          stream.write(JSON.stringify(entry) + '\n')
        }
      })

      proc.on('close', () => {
        stream.end()
        activeLogStreams.delete(sessionId)
      })

      activeLogStreams.set(sessionId, { proc, file })
      return { success: true, stream_started: true }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  async stopLogStream(sessionId: string = 'default') {
    const entry = activeLogStreams.get(sessionId)
    if (!entry) return { success: true }
    try { entry.proc.kill() } catch {}
    activeLogStreams.delete(sessionId)
    return { success: true }
  }

  async readLogStream(sessionId: string = 'default', limit: number = 100, since?: string) {
    const entry = activeLogStreams.get(sessionId)
    let file: string | undefined
    if (entry && entry.file) file = entry.file
    else {
      const tmpDir = process.env.TMPDIR || '/tmp'
      const candidate = path.join(tmpDir, `mobile-debug-log-${sessionId}.ndjson`)
      file = candidate
    }

    try {
      const data = await fsPromises.readFile(file, 'utf8').catch(() => '')
      if (!data) return { entries: [], crash_summary: { crash_detected: false } }
      const lines = data.split(/\r?\n/).filter(Boolean)

      const parsed = lines.map(l => {
        try {
          const obj: any = JSON.parse(l)
          if (typeof obj._iso === 'undefined') {
            let iso: string | null = null
            if (obj.timestamp) {
              const d = new Date(obj.timestamp)
              if (!isNaN(d.getTime())) iso = d.toISOString()
            }
            obj._iso = iso
          }
          if (typeof obj.crash === 'undefined') {
            const msg = (obj.message || '').toString()
            const exMatch = msg.match(/\b([A-Za-z0-9_$.]+Exception)\b/)
            if (/FATAL EXCEPTION/i.test(msg) || exMatch) {
              obj.crash = true
              if (exMatch) obj.exception = exMatch[1]
            } else {
              obj.crash = false
            }
          }
          return obj
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
        if (sinceMs !== null) filtered = parsed.filter(p => p._iso && (new Date(p._iso).getTime() >= sinceMs))
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
