import { spawn } from "child_process"
import { XMLParser } from "fast-xml-parser"
import { GetLogsResponse, CaptureAndroidScreenResponse, GetUITreeResponse, GetCurrentScreenResponse, UIElement, DeviceInfo } from "../types.js"
import { ADB, execAdb, getAndroidDeviceMetadata, getDeviceInfo, delay, getScreenResolution, traverseNode, parseLogLine } from "./utils.js"
import { createWriteStream } from "fs"
import { promises as fsPromises } from "fs"
import path from "path"

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
      const errorMessage = `Failed to get UI tree. ADB Path: '${ADB}'. Error: ${e instanceof Error ? e.message : String(e)}`;
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

  async getLogs(appId?: string, lines = 200, deviceId?: string): Promise<GetLogsResponse> {
    const metadata = await getAndroidDeviceMetadata(appId || "", deviceId)
    const deviceInfo = getDeviceInfo(deviceId || 'default', metadata)

    try {
      // We'll skip PID lookup for now to avoid potential hangs with 'pidof' on some emulators
      // and rely on robust string matching against the log line.
      
      // Get logs
      const stdout = await execAdb(['logcat', '-d', '-t', lines.toString(), '-v', 'threadtime'], deviceId)
      const allLogs = stdout.split('\n')
      
      let filteredLogs = allLogs
      if (appId) {
         // Filter by checking if the line contains the appId string.
         const matchingLogs = allLogs.filter(line => line.includes(appId))
         
         if (matchingLogs.length > 0) {
           filteredLogs = matchingLogs
         } else {
           // Fallback: if no logs match the appId, return the raw logs (last N lines)
           // This matches the behavior of the "working" version provided by the user,
           // ensuring they at least see system activity if the app is silent or crashing early.
           filteredLogs = allLogs
         }
      }
      
      return { device: deviceInfo, logs: filteredLogs, logCount: filteredLogs.length }
    } catch (e) {
      console.error("Error fetching logs:", e)
      return { device: deviceInfo, logs: [], logCount: 0 }
    }
  }

  async captureScreen(deviceId?: string): Promise<CaptureAndroidScreenResponse> {
    const metadata = await getAndroidDeviceMetadata("", deviceId)
    const deviceInfo: DeviceInfo = getDeviceInfo(deviceId || 'default', metadata)

    return new Promise((resolve, reject) => {
      // Need to construct ADB args manually since spawn handles it
      const args = deviceId ? ['-s', deviceId, 'exec-out', 'screencap', '-p'] : ['exec-out', 'screencap', '-p'];
      
      // Using spawn for screencap as well to ensure consistent process handling
      const child = spawn(ADB, args)
      
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

      child.on('close', (code) => {
        clearTimeout(timeout)
        if (code !== 0) {
          reject(new Error(stderr.trim() || `Screencap failed with code ${code}`))
          return
        }

        const screenshotBuffer = Buffer.concat(chunks)
        const screenshotBase64 = screenshotBuffer.toString('base64')

        // Get resolution
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
              resolution: { width, height }
            })
          })
          .catch(() => {
             resolve({
              device: deviceInfo,
              screenshot: screenshotBase64,
              resolution: { width: 0, height: 0 }
            })
          })
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
      // Dumpsys activity can be slow on some devices, so we increase timeout to 10s
      const output = await execAdb(['shell', 'dumpsys', 'activity', 'activities'], deviceId, { timeout: 10000 })
      
      // Find the line with mResumedActivity or ResumedActivity (some versions might differ)
      const lines = output.split('\n');
      // Prioritize mResumedActivity, then ResumedActivity. 
      // Use strict regex match to ensure it starts with the key, avoiding false positives like 'mLastResumedActivity'.
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

      // Regex to parse the line: ActivityRecord{... package/activity ...}
      // Matches: ActivityRecord{<hex> <user> <package>/<activity> ...}
      // We want to capture the component "package/activity" which is separated by space from other tokens.
      // We use greedy match ([^ \{}]+) for activity to ensure we get the full name until a space or closing brace.
      const match = resumedLine.match(/ActivityRecord\{[^ ]*(?:\s+[^ ]+)*\s+([^\/ ]+)\/([^ \{}]+)[^}]*\}/);

      if (match) {
        const packageName = match[1];
        let activityName = match[2];
        
        // Handle relative activity names (e.g. .LoginActivity)
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
      const proc = spawn(ADB, args)

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
    // Prefer active stream if present, otherwise fall back to a well-known NDJSON file for the session
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
