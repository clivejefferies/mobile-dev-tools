#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  ListToolsRequestSchema,
  CallToolRequestSchema
} from "@modelcontextprotocol/sdk/types.js"

import {
  StartAppResponse,
  DeviceInfo,
  TerminateAppResponse,
  RestartAppResponse,
  ResetAppDataResponse,
  GetUITreeResponse,
  GetCurrentScreenResponse,
  WaitForElementResponse,
  TapResponse,
  SwipeResponse,
  TypeTextResponse,
  PressBackResponse,
  InstallAppResponse
} from "./types.js"

import { AndroidObserve } from "./android/observe.js"
import { AndroidInteract } from "./android/interact.js"
import { iOSObserve } from "./ios/observe.js"
import { iOSInteract } from "./ios/interact.js"
import { resolveTargetDevice, listDevices } from "./resolve-device.js"
import { startAndroidLogStream, readLogStreamLines, stopAndroidLogStream } from "./android/utils.js"
import { startIOSLogStream, readIOSLogStreamLines, stopIOSLogStream } from "./ios/utils.js"

const androidObserve = new AndroidObserve()
const androidInteract = new AndroidInteract()
const iosObserve = new iOSObserve()
const iosInteract = new iOSInteract()

const server = new Server(
  {
    name: "mobile-debug-mcp",
    version: "0.7.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
)

function wrapResponse<T>(data: T) {
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify(data, null, 2)
    }]
  }
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "start_app",
      description: "Launch a mobile app on Android or iOS simulator",
      inputSchema: {
        type: "object",
        properties: {
          platform: {
            type: "string",
            enum: ["android", "ios"]
          },
          appId: {
            type: "string",
            description: "Android package name or iOS bundle id"
          },
          deviceId: {
            type: "string",
            description: "Device UDID (iOS) or Serial (Android). Defaults to booted/connected."
          }
        },
        required: ["platform", "appId"]
      }
    },
    {
      name: "terminate_app",
      description: "Terminate a mobile app on Android or iOS simulator",
      inputSchema: {
        type: "object",
        properties: {
          platform: {
            type: "string",
            enum: ["android", "ios"]
          },
          appId: {
            type: "string",
            description: "Android package name or iOS bundle id"
          },
          deviceId: {
            type: "string",
            description: "Device UDID (iOS) or Serial (Android). Defaults to booted/connected."
          }
        },
        required: ["platform", "appId"]
      }
    },
    {
      name: "restart_app",
      description: "Restart a mobile app on Android or iOS simulator",
      inputSchema: {
        type: "object",
        properties: {
          platform: {
            type: "string",
            enum: ["android", "ios"]
          },
          appId: {
            type: "string",
            description: "Android package name or iOS bundle id"
          },
          deviceId: {
            type: "string",
            description: "Device UDID (iOS) or Serial (Android). Defaults to booted/connected."
          }
        },
        required: ["platform", "appId"]
      }
    },
    {
      name: "reset_app_data",
      description: "Reset app data (clear storage) for a mobile app on Android or iOS simulator",
      inputSchema: {
        type: "object",
        properties: {
          platform: {
            type: "string",
            enum: ["android", "ios"]
          },
          appId: {
            type: "string",
            description: "Android package name or iOS bundle id"
          },
          deviceId: {
            type: "string",
            description: "Device UDID (iOS) or Serial (Android). Defaults to booted/connected."
          }
        },
        required: ["platform", "appId"]
      }
    },
    {
      name: "install_app",
      description: "Install an app on Android (apk) or iOS simulator/device (ipa/.app).",
      inputSchema: {
        type: "object",
        properties: {
          platform: { type: "string", enum: ["android", "ios"] },
          appPath: { type: "string", description: "Path to APK (Android) or .app/.ipa (iOS) on the host machine" },
          deviceId: { type: "string", description: "Device UDID (iOS) or Serial (Android). Defaults to booted/connected." }
        },
        required: ["platform", "appPath"]
      }
    },
    {
      name: "get_logs",
      description: "Get recent logs from Android or iOS simulator. Returns device metadata and the log output.",
      inputSchema: {
        type: "object",
        properties: {
          platform: {
            type: "string",
            enum: ["android", "ios"]
          },
          appId: {
            type: "string",
            description: "Filter by Android package name or iOS bundle id"
          },
          deviceId: {
            type: "string",
            description: "Device UDID (iOS) or Serial (Android). Defaults to booted/connected."
          },
          lines: {
            type: "number",
            description: "Number of log lines (android only)"
          }
        },
        required: ["platform"]
      }
    },
    {
      name: "list_devices",
      description: "List connected devices and their metadata (android + ios).",
      inputSchema: {
        type: "object",
        properties: {
          platform: { type: "string", enum: ["android", "ios"] }
        }
      }
    },
    {
      name: "capture_screenshot",
      description: "Capture a screenshot from an Android device or iOS simulator. Returns device metadata and the screenshot image.",
      inputSchema: {
        type: "object",
        properties: {
          platform: {
            type: "string",
            enum: ["android", "ios"]
          },
          deviceId: {
            type: "string",
            description: "Device UDID (iOS) or Serial (Android). Defaults to booted/connected."
          }
        },
        required: ["platform"]
      }
    },
    {
      name: "start_log_stream",
      description: "Start streaming logs for a target application on Android or iOS. For Android this uses adb logcat --pid=<pid>; for iOS it streams `xcrun simctl spawn <device> log stream` with a predicate.",
      inputSchema: {
        type: "object",
        properties: {
          platform: { type: "string", enum: ["android", "ios"], default: "android" },
          packageName: { type: "string", description: "Android package name or iOS bundle id" },
          level: { type: "string", enum: ["error", "warn", "info", "debug"], default: "error" },
          deviceId: { type: "string", description: "Device Serial (Android) or UDID (iOS). Defaults to connected/booted device." },
          sessionId: { type: "string", description: "Session identifier for the log stream" }
        },
        required: ["packageName"]
      }
    },
    {
      name: "read_log_stream",
      description: "Read accumulated log stream entries for the active session.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" }
        }
      }
    },
    {
      name: "stop_log_stream",
      description: "Stop an active log stream for the session.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" }
        }
      }
    },

    {
      name: "get_ui_tree",
      description: "Get the current UI hierarchy from an Android device or iOS simulator. Returns a structured JSON representation of the screen content.",
      inputSchema: {
        type: "object",
        properties: {
          platform: {
            type: "string",
            enum: ["android", "ios"],
            description: "Platform to get UI tree for"
          },
          deviceId: {
            type: "string",
            description: "Device Serial (Android) or UDID (iOS). Defaults to connected/booted device."
          }
        },
        required: ["platform"]
      }
    },
    {
      name: "get_current_screen",
      description: "Get the currently visible activity on an Android device. Returns package and activity name.",
      inputSchema: {
        type: "object",
        properties: {
          deviceId: {
            type: "string",
            description: "Device Serial (Android). Defaults to connected/booted device."
          }
        }
      }
    },
    {
      name: "wait_for_element",
      description: "Wait until a UI element with matching text appears on screen or timeout is reached.",
      inputSchema: {
        type: "object",
        properties: {
          platform: {
            type: "string",
            enum: ["android", "ios"],
            description: "Platform to check"
          },
          text: {
            type: "string",
            description: "Text content of the element to wait for"
          },
          timeout: {
            type: "number",
            description: "Max wait time in ms (default 10000)",
            default: 10000
          },
          deviceId: {
            type: "string",
            description: "Device Serial/UDID. Defaults to connected/booted device."
          }
        },
        required: ["platform", "text"]
      }
    },
    {
      name: "tap",
      description: "Simulate a finger tap on the device screen at specific coordinates.",
      inputSchema: {
        type: "object",
        properties: {
          platform: {
            type: "string",
            enum: ["android", "ios"],
            description: "Platform to tap on"
          },
          x: {
            type: "number",
            description: "X coordinate"
          },
          y: {
            type: "number",
            description: "Y coordinate"
          },
          deviceId: {
            type: "string",
            description: "Device Serial/UDID. Defaults to connected/booted device."
          }
        },
        required: ["x", "y"]
      }
    },
    {
      name: "swipe",
      description: "Simulate a swipe gesture on an Android device.",
      inputSchema: {
        type: "object",
        properties: {
          platform: {
            type: "string",
            enum: ["android"],
            description: "Platform to swipe on (currently only android supported)"
          },
          x1: { type: "number", description: "Start X coordinate" },
          y1: { type: "number", description: "Start Y coordinate" },
          x2: { type: "number", description: "End X coordinate" },
          y2: { type: "number", description: "End Y coordinate" },
          duration: { type: "number", description: "Duration in ms" },
          deviceId: {
            type: "string",
            description: "Device Serial/UDID. Defaults to connected/booted device."
          }
        },
        required: ["x1", "y1", "x2", "y2", "duration"]
      }
    },
    {
      name: "type_text",
      description: "Type text into the currently focused input field on an Android device.",
      inputSchema: {
        type: "object",
        properties: {
          platform: {
            type: "string",
            enum: ["android"],
            description: "Platform to type on (currently only android supported)"
          },
          text: {
            type: "string",
            description: "The text to type"
          },
          deviceId: {
            type: "string",
            description: "Device Serial/UDID. Defaults to connected/booted device."
          }
        },
        required: ["text"]
      }
    },
    {
      name: "press_back",
      description: "Simulate pressing the Android Back button.",
      inputSchema: {
        type: "object",
        properties: {
          platform: {
            type: "string",
            enum: ["android"],
            description: "Platform (currently only android supported)"
          },
          deviceId: {
            type: "string",
            description: "Device Serial/UDID. Defaults to connected/booted device."
          }
        }
      }
    }
  ]
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    if (name === "start_app") {
      const { platform, appId, deviceId } = args as {
        platform: "android" | "ios"
        appId: string
        deviceId?: string
      }

      let appStarted: boolean
      let launchTimeMs: number
      let deviceInfo: DeviceInfo

      if (platform === "android") {
        const resolved = await resolveTargetDevice({ platform: 'android', appId, deviceId })
        const result = await androidInteract.startApp(appId, resolved.id)
        appStarted = result.appStarted
        launchTimeMs = result.launchTimeMs
        deviceInfo = result.device
      } else {
        const resolved = await resolveTargetDevice({ platform: 'ios', appId, deviceId })
        const result = await iosInteract.startApp(appId, resolved.id)
        appStarted = result.appStarted
        launchTimeMs = result.launchTimeMs
        deviceInfo = result.device
      }

      const response: StartAppResponse = {
        device: deviceInfo,
        appStarted,
        launchTimeMs
      }

      return wrapResponse(response)
    }

    if (name === "terminate_app") {
      const { platform, appId, deviceId } = args as {
        platform: "android" | "ios"
        appId: string
        deviceId?: string
      }

      let appTerminated: boolean
      let deviceInfo: DeviceInfo

      if (platform === "android") {
        const resolved = await resolveTargetDevice({ platform: 'android', appId, deviceId })
        const result = await androidInteract.terminateApp(appId, resolved.id)
        appTerminated = result.appTerminated
        deviceInfo = result.device
      } else {
        const resolved = await resolveTargetDevice({ platform: 'ios', appId, deviceId })
        const result = await iosInteract.terminateApp(appId, resolved.id)
        appTerminated = result.appTerminated
        deviceInfo = result.device
      }

      const response: TerminateAppResponse = {
        device: deviceInfo,
        appTerminated
      }

      return wrapResponse(response)
    }

    if (name === "restart_app") {
      const { platform, appId, deviceId } = args as {
        platform: "android" | "ios"
        appId: string
        deviceId?: string
      }

      let appRestarted: boolean
      let launchTimeMs: number
      let deviceInfo: DeviceInfo

      if (platform === "android") {
        const resolved = await resolveTargetDevice({ platform: 'android', appId, deviceId })
        const result = await androidInteract.restartApp(appId, resolved.id)
        appRestarted = result.appRestarted
        launchTimeMs = result.launchTimeMs
        deviceInfo = result.device
      } else {
        const resolved = await resolveTargetDevice({ platform: 'ios', appId, deviceId })
        const result = await iosInteract.restartApp(appId, resolved.id)
        appRestarted = result.appRestarted
        launchTimeMs = result.launchTimeMs
        deviceInfo = result.device
      }

      const response: RestartAppResponse = {
        device: deviceInfo,
        appRestarted,
        launchTimeMs
      }

      return wrapResponse(response)
    }

    if (name === "reset_app_data") {
      const { platform, appId, deviceId } = args as {
        platform: "android" | "ios"
        appId: string
        deviceId?: string
      }

      let dataCleared: boolean
      let deviceInfo: DeviceInfo

      if (platform === "android") {
        const resolved = await resolveTargetDevice({ platform: 'android', appId, deviceId })
        const result = await androidInteract.resetAppData(appId, resolved.id)
        dataCleared = result.dataCleared
        deviceInfo = result.device
      } else {
        const resolved = await resolveTargetDevice({ platform: 'ios', appId, deviceId })
        const result = await iosInteract.resetAppData(appId, resolved.id)
        dataCleared = result.dataCleared
        deviceInfo = result.device
      }

      const response: ResetAppDataResponse = {
        device: deviceInfo,
        dataCleared
      }

      return wrapResponse(response)
    }

    if (name === "install_app") {
      const { platform, appPath, deviceId } = args as {
        platform: "android" | "ios"
        appPath: string
        deviceId?: string
      }

      let installed: boolean
      let output: string | undefined
      let deviceInfo: DeviceInfo
      let errorMsg: string | undefined

      if (platform === "android") {
        const resolved = await resolveTargetDevice({ platform: 'android', deviceId })
        const result = await androidInteract.installApp(appPath, resolved.id)
        installed = result.installed
        output = (result as any).output
        deviceInfo = result.device
        errorMsg = (result as any).error
      } else {
        const resolved = await resolveTargetDevice({ platform: 'ios', deviceId })
        const result = await iosInteract.installApp(appPath, resolved.id)
        installed = result.installed
        output = (result as any).output
        deviceInfo = result.device
        errorMsg = (result as any).error
      }

      const response: InstallAppResponse = {
        device: deviceInfo,
        installed,
        output,
        error: errorMsg
      }

      return wrapResponse(response)
    }

    if (name === "get_logs") {
      const { platform, appId, deviceId, lines } = args as {
        platform: "android" | "ios"
        appId?: string
        deviceId?: string
        lines?: number
      }

      let logs: string[]
      let deviceInfo: DeviceInfo

      if (platform === "android") {
        // Resolve an explicit target device when multiple are attached
        const resolved = await resolveTargetDevice({ platform: 'android', appId, deviceId })
        deviceInfo = resolved
        const response = await androidObserve.getLogs(appId, lines ?? 200, resolved.id)
        logs = Array.isArray(response.logs) ? response.logs : []
      } else {
        const resolved = await resolveTargetDevice({ platform: 'ios', appId, deviceId })
        deviceInfo = resolved
        const response = await iosObserve.getLogs(appId, resolved.id)
        logs = Array.isArray(response.logs) ? response.logs : []
      }

      // Filter crash lines (e.g. lines containing 'FATAL EXCEPTION') for internal or AI use
      const crashLines = logs.filter(line => line.includes('FATAL EXCEPTION'))

      // Return device metadata plus logs
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              device: deviceInfo,
              result: {
                lines: logs.length,
                crashLines: crashLines.length > 0 ? crashLines : undefined
              }
            }, null, 2)
          },
          {
            type: "text",
            text: logs.join("\n")
          }
        ]
      }
    }

    if (name === "list_devices") {
      const { platform, appId } = (args || {}) as { platform?: "android" | "ios"; appId?: string }
      const devices = await listDevices(platform, appId)
      return wrapResponse({ devices })
    }


    if (name === "capture_screenshot") {
      const { platform, deviceId } = args as { platform: "android" | "ios"; deviceId?: string }

      let screenshot: string
      let resolution: { width: number; height: number }
      let deviceInfo: DeviceInfo

      if (platform === "android") {
        const resolved = await resolveTargetDevice({ platform: 'android', deviceId })
        deviceInfo = resolved
        const result = await androidObserve.captureScreen(resolved.id)
        screenshot = result.screenshot
        resolution = result.resolution
      } else {
        const resolved = await resolveTargetDevice({ platform: 'ios', deviceId })
        deviceInfo = resolved
        const result = await iosObserve.captureScreenshot(resolved.id)
        screenshot = result.screenshot
        resolution = result.resolution
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              device: deviceInfo,
              result: {
                resolution
              }
            }, null, 2)
          },
          {
            type: "image",
            data: screenshot,
            mimeType: "image/png"
          }
        ]
      }
    }

    if (name === "get_ui_tree") {
      const { platform, deviceId } = args as { platform: "android" | "ios", deviceId?: string }
      
      let result: GetUITreeResponse
      if (platform === "android") {
        const resolved = await resolveTargetDevice({ platform: 'android', deviceId })
        result = await androidObserve.getUITree(resolved.id)
      } else if (platform === "ios") {
        const resolved = await resolveTargetDevice({ platform: 'ios', deviceId })
        result = await iosObserve.getUITree(resolved.id)
      } else {
        throw new Error(`Platform ${platform} not supported for get_ui_tree`)
      }

      return wrapResponse(result)
    }

    if (name === "get_current_screen") {
      const { deviceId } = (args || {}) as { deviceId?: string }
      const resolved = await resolveTargetDevice({ platform: 'android', deviceId })
      const result = await androidObserve.getCurrentScreen(resolved.id)
      return wrapResponse(result)
    }

    if (name === "wait_for_element") {
      const { platform, text, timeout, deviceId } = (args || {}) as {
        platform: "android" | "ios"
        text: string
        timeout?: number
        deviceId?: string
      }
      
      const effectiveTimeout = timeout ?? 10000;
      
      let result: WaitForElementResponse;
      if (platform === "android") {
        const resolved = await resolveTargetDevice({ platform: 'android', deviceId })
        result = await androidInteract.waitForElement(text, effectiveTimeout, resolved.id)
      } else {
        const resolved = await resolveTargetDevice({ platform: 'ios', deviceId })
        result = await iosInteract.waitForElement(text, effectiveTimeout, resolved.id)
      }
      return wrapResponse(result)
    }

    if (name === "tap") {
      const { platform, x, y, deviceId } = (args || {}) as {
        platform?: "android" | "ios"
        x: number
        y: number
        deviceId?: string
      }

      const effectivePlatform = platform || "android";
      
      // Basic validation
      if (typeof x !== 'number' || typeof y !== 'number') {
        throw new Error("x and y coordinates are required and must be numbers");
      }

      let result: TapResponse;
      if (effectivePlatform === "android") {
        const resolved = await resolveTargetDevice({ platform: 'android', deviceId })
        result = await androidInteract.tap(x, y, resolved.id)
      } else {
        const resolved = await resolveTargetDevice({ platform: 'ios', deviceId })
        result = await iosInteract.tap(x, y, resolved.id)
      }
      return wrapResponse(result)
    }

    if (name === "swipe") {
      const { platform, x1, y1, x2, y2, duration, deviceId } = (args || {}) as {
        platform?: "android"
        x1: number
        y1: number
        x2: number
        y2: number
        duration: number
        deviceId?: string
      }

      const effectivePlatform = platform || "android";
      
      if (typeof x1 !== 'number' || typeof y1 !== 'number' || typeof x2 !== 'number' || typeof y2 !== 'number' || typeof duration !== 'number') {
        throw new Error("x1, y1, x2, y2, and duration are required and must be numbers");
      }

      let result: SwipeResponse;
      if (effectivePlatform === "android") {
        const resolved = await resolveTargetDevice({ platform: 'android', deviceId })
        result = await androidInteract.swipe(x1, y1, x2, y2, duration, resolved.id)
      } else {
        throw new Error(`Platform ${effectivePlatform} not supported for swipe`)
      }
      return wrapResponse(result)
    }

    if (name === "type_text") {
      const { platform, text, deviceId } = (args || {}) as {
        platform?: "android"
        text: string
        deviceId?: string
      }

      const effectivePlatform = platform || "android";
      
      if (typeof text !== 'string') {
        throw new Error("text is required and must be a string");
      }

      let result: TypeTextResponse;
      if (effectivePlatform === "android") {
        const resolved = await resolveTargetDevice({ platform: 'android', deviceId })
        result = await androidInteract.typeText(text, resolved.id)
      } else {
        throw new Error(`Platform ${effectivePlatform} not supported for type_text`)
      }
      return wrapResponse(result)
    }

    if (name === "press_back") {
      const { platform, deviceId } = (args || {}) as {
        platform?: "android"
        deviceId?: string
      }
      
      const effectivePlatform = platform || "android";
      
      if (effectivePlatform !== "android") {
        throw new Error(`Platform ${effectivePlatform} not supported for press_back`)
      }

      const resolved = await resolveTargetDevice({ platform: 'android', deviceId })
      const result = await androidInteract.pressBack(resolved.id)
      return wrapResponse(result)
    }

    if (name === 'start_log_stream') {
      const { platform, packageName, level, sessionId: argSession, deviceId } = args as { platform?: 'android' | 'ios'; packageName: string; level?: 'error' | 'warn' | 'info' | 'debug'; sessionId?: string; deviceId?: string }
      const sessionId = argSession || 'default'
      const effectivePlatform = platform || 'android'
      if (effectivePlatform === 'android') {
        const resolved = await resolveTargetDevice({ platform: 'android', appId: packageName, deviceId })
        const res = await startAndroidLogStream(packageName, level || 'error', resolved.id, sessionId)
        return wrapResponse(res)
      } else {
        const resolved = await resolveTargetDevice({ platform: 'ios', appId: packageName, deviceId })
        const res = await startIOSLogStream(packageName, level || 'error', resolved.id, sessionId)
        return wrapResponse(res)
      }
    }

    if (name === 'read_log_stream') {
      const { platform, sessionId: argSession, limit, since } = (args || {}) as { platform?: 'android' | 'ios'; sessionId?: string, limit?: number, since?: string }
      const sid = argSession || 'default'
      const effectivePlatform = platform || 'android'
      if (effectivePlatform === 'android') {
        const { entries, crash_summary } = await readLogStreamLines(sid, limit ?? 100, since)
        return wrapResponse({ entries, crash_summary })
      } else {
        const { entries, crash_summary } = await readIOSLogStreamLines(sid, limit ?? 100, since)
        return wrapResponse({ entries, crash_summary })
      }
    }

    if (name === 'stop_log_stream') {
      const { platform, sessionId: argSession } = (args || {}) as { platform?: 'android' | 'ios'; sessionId?: string }
      const sid = argSession || 'default'
      const effectivePlatform = platform || 'android'
      if (effectivePlatform === 'android') {
        const res = await stopAndroidLogStream(sid)
        return wrapResponse(res)
      } else {
        const res = await stopIOSLogStream(sid)
        return wrapResponse(res)
      }
    }
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error executing tool ${name}: ${error instanceof Error ? error.message : String(error)}` }]
    }
  }

  throw new Error(`Unknown tool: ${name}`)
})

const transport = new StdioServerTransport()

async function main() {
  await server.connect(transport)
}

main().catch((error) => {
  console.error("Server failed to start:", error)
})