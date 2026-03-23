#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  ListToolsRequestSchema,
  CallToolRequestSchema
} from "@modelcontextprotocol/sdk/types.js"

import {
  StartAppResponse,
  TerminateAppResponse,
  RestartAppResponse,
  ResetAppDataResponse,
  InstallAppResponse
} from "./types.js"

import { ToolsManage } from './manage/index.js'
import { ToolsInteract } from './interact/index.js'
import { ToolsObserve } from './observe/index.js'
import { AndroidManage } from './manage/index.js'
import { iOSManage } from './manage/index.js'


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
      description: "Install an app on Android or iOS. Accepts a built binary (apk/.ipa/.app) or a project directory to build then install. platform and projectType are required.",
      inputSchema: {
        type: "object",
        properties: {
          platform: { type: "string", enum: ["android", "ios"], description: "Platform to install to (required)." },
          projectType: { type: "string", enum: ["native","kmp","react-native","flutter"], description: "Project type to guide build/install tool selection (required)." },
          appPath: { type: "string", description: "Path to APK, .app, .ipa, or project directory" },
          deviceId: { type: "string", description: "Device UDID (iOS) or Serial (Android). Defaults to booted/connected." }
        },
        required: ["platform", "projectType", "appPath"]
      }
    },
    {
      name: "build_app",
      description: "Build a project for Android or iOS and return the built artifact path. Does not install. platform and projectType are required.",
      inputSchema: {
        type: "object",
        properties: {
          platform: { type: "string", enum: ["android", "ios"], description: "Platform to build for (required)." },
          projectType: { type: "string", enum: ["native","kmp","react-native","flutter"], description: "Project type to guide build tool selection (required)." },
          projectPath: { type: "string", description: "Path to project directory (contains gradlew or xcodeproj/xcworkspace)" },
          variant: { type: "string", description: "Optional build variant (e.g., Debug/Release)" }
        },
        required: ["platform", "projectType", "projectPath"]
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
      name: "get_screen_fingerprint",
      description: "Generate a stable fingerprint representing the current visible screen (activity + visible UI elements).",
      inputSchema: {
        type: "object",
        properties: {
          platform: { type: "string", enum: ["android", "ios"], description: "Optional platform override (android|ios)" },
          deviceId: { type: "string", description: "Optional device id/udid to target" }
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
            enum: ["android","ios"],
            description: "Platform to swipe on (android or ios)"
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
      name: "scroll_to_element",
      description: "Scroll the current screen until a target UI element becomes visible, then return its details.",
      inputSchema: {
        type: "object",
        properties: {
          platform: { type: "string", enum: ["android", "ios"], description: "Platform to operate on (required)" },
          selector: {
            type: "object",
            properties: {
              text: { type: "string" },
              resourceId: { type: "string" },
              contentDesc: { type: "string" },
              className: { type: "string" }
            }
          },
          direction: { type: "string", enum: ["down", "up"], default: "down" },
          maxScrolls: { type: "number", default: 10 },
          scrollAmount: { type: "number", default: 0.7 },
          deviceId: { type: "string", description: "Device UDID (iOS) or Serial (Android). Defaults to booted/connected." }
        },
        required: ["platform", "selector"]
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
      const { platform, appId, deviceId } = args as any
      // Defensive validation: ensure caller provided platform and appId.
      if (!platform || !appId) {
        const msg = 'Both platform and appId parameters are required (platform: ios|android, appId: bundle id or package name).'
        const payload = { ts: new Date().toISOString(), tool: 'start_app', args }
        let logged = false

        // Prefer the diagnostics module when available
        try {
          const diag = require('./utils/diagnostics.js')
          if (diag && diag.appendDiagnosticFile) {
            diag.appendDiagnosticFile('bad_requests.log', payload)
            logged = true
          }
        } catch (err) {
          console.error('Diagnostics append failed:', String(err))
        }

        // Fallback to /tmp file (synchronous) and report failures rather than swallowing
        if (!logged) {
          try {
            const fs = require('fs')
            fs.appendFileSync('/tmp/mcp_bad_requests.log', JSON.stringify(payload) + '\n')
            logged = true
          } catch (err) {
            console.error('Failed to write bad request to /tmp/mcp_bad_requests.log:', String(err))
          }
        }

        // Final fallback: emit payload to stderr so it's visible in server logs
        if (!logged) {
          try {
            console.error('Bad request (start_app) payload:', JSON.stringify(payload))
          } catch (err) {
            // Last resort: still log the failure
            console.error('Failed to emit bad request payload to stderr:', String(err))
          }
        }

        return wrapResponse({ error: msg })
      }

      const res = await (platform === 'android' ? new AndroidManage().startApp(appId, deviceId) : new iOSManage().startApp(appId, deviceId))
      const response: StartAppResponse = {
        device: res.device,
        appStarted: res.appStarted,
        launchTimeMs: res.launchTimeMs
      }
      return wrapResponse(response)
    }

    if (name === "terminate_app") {
      const { platform, appId, deviceId } = args as any
      const res = await (platform === 'android' ? new AndroidManage().terminateApp(appId, deviceId) : new iOSManage().terminateApp(appId, deviceId))
      const response: TerminateAppResponse = { device: res.device, appTerminated: res.appTerminated }
      return wrapResponse(response)
    }

    if (name === "restart_app") {
      const { platform, appId, deviceId } = args as any
      const res = await (platform === 'android' ? new AndroidManage().restartApp(appId, deviceId) : new iOSManage().restartApp(appId, deviceId))
      const response: RestartAppResponse = { device: res.device, appRestarted: res.appRestarted, launchTimeMs: res.launchTimeMs }
      return wrapResponse(response)
    }

    if (name === "reset_app_data") {
      const { platform, appId, deviceId } = args as any
      const res = await (platform === 'android' ? new AndroidManage().resetAppData(appId, deviceId) : new iOSManage().resetAppData(appId, deviceId))
      const response: ResetAppDataResponse = { device: res.device, dataCleared: res.dataCleared }
      return wrapResponse(response)
    }

    if (name === "install_app") {
        const { platform, projectType, appPath, deviceId } = args as any
        const res = await ToolsManage.installAppHandler({ platform, appPath, deviceId, projectType })
        const response: InstallAppResponse = {
          device: res.device,
          installed: res.installed,
          output: (res as any).output,
          error: (res as any).error
        }
        return wrapResponse(response)
      }

      if (name === "build_app") {
        const { platform, projectType, projectPath, variant } = args as any
        const res = await ToolsManage.buildAppHandler({ platform, projectPath, variant, projectType })
        return wrapResponse(res)
      }

      if (name === 'build_and_install') {
        const { platform, projectType, projectPath, deviceId, timeout } = args as any
        const res = await ToolsManage.buildAndInstallHandler({ platform, projectPath, deviceId, timeout, projectType })
        // res: { ndjson, result }
        return {
          content: [
            { type: 'text', text: res.ndjson },
            { type: 'text', text: JSON.stringify(res.result, null, 2) }
          ]
        }
      }


    if (name === "get_logs") {
      const { platform, appId, deviceId, lines } = args as any
      const res = await ToolsObserve.getLogsHandler({ platform, appId, deviceId, lines })
      return {
        content: [
          { type: 'text', text: JSON.stringify({ device: res.device, result: { lines: res.logs.length, crashLines: res.crashLines.length > 0 ? res.crashLines : undefined } }, null, 2) },
          { type: 'text', text: (res.logs || []).join('\n') }
        ]
      }
    }

    if (name === "list_devices") {
      const { platform, appId } = (args || {}) as any
      const res = await ToolsManage.listDevicesHandler({ platform, appId })
      return wrapResponse(res)
    }


    if (name === "capture_screenshot") {
      const { platform, deviceId } = args as any
      const res = await ToolsObserve.captureScreenshotHandler({ platform, deviceId })
      return {
        content: [
          { type: 'text', text: JSON.stringify({ device: res.device, result: { resolution: (res as any).resolution } }, null, 2) },
          { type: 'image', data: (res as any).screenshot, mimeType: 'image/png' }
        ]
      }
    }

    if (name === "get_ui_tree") {
      const { platform, deviceId } = args as any
      const res = await ToolsObserve.getUITreeHandler({ platform, deviceId })
      return wrapResponse(res)
    }

    if (name === "get_current_screen") {
      const { deviceId } = (args || {}) as any
      const res = await ToolsObserve.getCurrentScreenHandler({ deviceId })
      return wrapResponse(res)
    }

    if (name === "get_screen_fingerprint") {
      const { platform, deviceId } = (args || {}) as any
      const res = await ToolsObserve.getScreenFingerprintHandler({ platform, deviceId })
      return wrapResponse(res)
    }

    if (name === "wait_for_element") {
      const { platform, text, timeout, deviceId } = (args || {}) as any
      const res = await ToolsInteract.waitForElementHandler({ platform, text, timeout, deviceId })
      return wrapResponse(res)
    }

    if (name === "tap") {
      const { platform, x, y, deviceId } = (args || {}) as any
      const res = await ToolsInteract.tapHandler({ platform, x, y, deviceId })
      return wrapResponse(res)
    }

    if (name === "swipe") {
      const { platform = 'android', x1, y1, x2, y2, duration, deviceId } = (args || {}) as any
      const res = await ToolsInteract.swipeHandler({ platform, x1, y1, x2, y2, duration, deviceId })
      return wrapResponse(res)
    }

    if (name === "scroll_to_element") {
      const { platform, selector, direction, maxScrolls, scrollAmount, deviceId } = (args || {}) as any
      const res = await ToolsInteract.scrollToElementHandler({ platform, selector, direction, maxScrolls, scrollAmount, deviceId })
      return wrapResponse(res)
    }

    if (name === "type_text") {
      const { text, deviceId } = (args || {}) as any
      const res = await ToolsInteract.typeTextHandler({ text, deviceId })
      return wrapResponse(res)
    }

    if (name === "press_back") {
      const { deviceId } = (args || {}) as any
      const res = await ToolsInteract.pressBackHandler({ deviceId })
      return wrapResponse(res)
    }

    if (name === 'start_log_stream') {
      const { platform, packageName, level, sessionId, deviceId } = args as any
      const res = await ToolsObserve.startLogStreamHandler({ platform, packageName, level, sessionId, deviceId })
      return wrapResponse(res)
    }

    if (name === 'read_log_stream') {
      const { platform, sessionId, limit, since } = args as any
      const res = await ToolsObserve.readLogStreamHandler({ platform, sessionId, limit, since })
      return wrapResponse(res)
    }

    if (name === 'stop_log_stream') {
      const { platform, sessionId } = (args || {}) as any
      const res = await ToolsObserve.stopLogStreamHandler({ platform, sessionId })
      return wrapResponse(res)
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
  await (server as any).connect(transport)
}

main().catch((error) => {
  console.error("Server failed to start:", error)
})