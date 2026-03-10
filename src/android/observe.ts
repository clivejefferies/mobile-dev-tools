import { spawn } from "child_process"
import { XMLParser } from "fast-xml-parser"
import { GetLogsResponse, CaptureAndroidScreenResponse, GetUITreeResponse, UIElement, DeviceInfo } from "../types.js"
import { ADB, execAdb, getAndroidDeviceMetadata, getDeviceInfo } from "./utils.js"

// --- Helper Functions Specific to Observe ---

function parseBounds(bounds: string): [number, number, number, number] {
  const match = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (match) {
    return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3]), parseInt(match[4])];
  }
  return [0, 0, 0, 0];
}

async function getScreenResolution(deviceId?: string): Promise<{ width: number; height: number }> {
  try {
    const output = await execAdb(['shell', 'wm', 'size'], deviceId);
    const match = output.match(/Physical size: (\d+)x(\d+)/);
    if (match) {
      return { width: parseInt(match[1]), height: parseInt(match[2]) };
    }
  } catch (e) {
    // ignore
  }
  return { width: 0, height: 0 };
}

function traverseNode(node: any, elements: UIElement[], parentIndex: number = -1): number {
  if (!node) return -1;

  let currentIndex = -1;

  // Check if it's a valid node with attributes we care about
  if (node['@_class']) {
    const element: UIElement = {
      text: node['@_text'] || null,
      contentDescription: node['@_content-desc'] || null,
      type: node['@_class'] || 'unknown',
      resourceId: node['@_resource-id'] || null,
      clickable: node['@_clickable'] === 'true',
      enabled: node['@_enabled'] === 'true',
      visible: true, // uiautomator dump typically includes visible elements
      bounds: parseBounds(node['@_bounds'] || '[0,0][0,0]')
    };
    
    if (parentIndex !== -1) {
      element.parentId = parentIndex;
    }
    
    elements.push(element);
    currentIndex = elements.length - 1;
  }

  // If current node was skipped (no class), children inherit parentIndex
  // If current node was added, children use currentIndex
  const nextParentIndex = currentIndex !== -1 ? currentIndex : parentIndex;
  const childrenIndices: number[] = [];

  // Traverse children
  if (node.node) {
      if (Array.isArray(node.node)) {
          node.node.forEach((child: any) => {
            const childIndex = traverseNode(child, elements, nextParentIndex);
            if (childIndex !== -1) childrenIndices.push(childIndex);
          });
      } else {
          const childIndex = traverseNode(node.node, elements, nextParentIndex);
          if (childIndex !== -1) childrenIndices.push(childIndex);
      }
  }
  
  // Update current element with children if it was added
  if (currentIndex !== -1 && childrenIndices.length > 0) {
      elements[currentIndex].children = childrenIndices;
  }
  
  return currentIndex;
}

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

      // Dump UI hierarchy
      // We suppress stderr because uiautomator dump sometimes outputs "UI hierchary dumped to: /sdcard/ui.xml" to stdout/stderr
      await execAdb(['shell', 'uiautomator', 'dump', '/sdcard/ui.xml'], deviceId);
      
      // Read the file
      const xmlContent = await execAdb(['shell', 'cat', '/sdcard/ui.xml'], deviceId);
      if (!xmlContent || xmlContent.trim().length === 0) {
          throw new Error("Failed to read UI XML. File is empty.");
      }
      
      if (xmlContent.includes("ERROR:")) {
           throw new Error(`UI Automator dump failed: ${xmlContent}`);
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
}
