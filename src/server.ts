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
  GetUITreeResponse
} from "./types.js"

import { AndroidObserve } from "./android/observe.js"
import { AndroidInteract } from "./android/interact.js"
import { iOSObserve } from "./ios/observe.js"
import { iOSInteract } from "./ios/interact.js"

const androidObserve = new AndroidObserve()
const androidInteract = new AndroidInteract()
const iosObserve = new iOSObserve()
const iosInteract = new iOSInteract()

const server = new Server(
  {
    name: "mobile-debug-mcp",
    version: "0.4.0"
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
        const result = await androidInteract.startApp(appId, deviceId)
        appStarted = result.appStarted
        launchTimeMs = result.launchTimeMs
        deviceInfo = result.device
      } else {
        const result = await iosInteract.startApp(appId, deviceId)
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
        const result = await androidInteract.terminateApp(appId, deviceId)
        appTerminated = result.appTerminated
        deviceInfo = result.device
      } else {
        const result = await iosInteract.terminateApp(appId, deviceId)
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
        const result = await androidInteract.restartApp(appId, deviceId)
        appRestarted = result.appRestarted
        launchTimeMs = result.launchTimeMs
        deviceInfo = result.device
      } else {
        const result = await iosInteract.restartApp(appId, deviceId)
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
        const result = await androidInteract.resetAppData(appId, deviceId)
        dataCleared = result.dataCleared
        deviceInfo = result.device
      } else {
        const result = await iosInteract.resetAppData(appId, deviceId)
        dataCleared = result.dataCleared
        deviceInfo = result.device
      }

      const response: ResetAppDataResponse = {
        device: deviceInfo,
        dataCleared
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
        deviceInfo = await androidObserve.getDeviceMetadata(appId || "", deviceId)
        const response = await androidObserve.getLogs(appId, lines ?? 200, deviceId)
        logs = Array.isArray(response.logs) ? response.logs : []
      } else {
        deviceInfo = await iosObserve.getDeviceMetadata(deviceId)
        const response = await iosObserve.getLogs(appId, deviceId)
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

    if (name === "capture_screenshot") {
      const { platform, deviceId } = args as { platform: "android" | "ios"; deviceId?: string }

      let screenshot: string
      let resolution: { width: number; height: number }
      let deviceInfo: DeviceInfo

      if (platform === "android") {
        deviceInfo = await androidObserve.getDeviceMetadata("", deviceId)
        const result = await androidObserve.captureScreen(deviceId)
        screenshot = result.screenshot
        resolution = result.resolution
      } else {
        deviceInfo = await iosObserve.getDeviceMetadata(deviceId)
        const result = await iosObserve.captureScreenshot(deviceId)
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
        result = await androidObserve.getUITree(deviceId)
      } else if (platform === "ios") {
        result = await iosObserve.getUITree(deviceId)
      } else {
        throw new Error(`Platform ${platform} not supported for get_ui_tree`)
      }

      return wrapResponse(result)
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