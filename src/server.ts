import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  ListToolsRequestSchema,
  CallToolRequestSchema
} from "@modelcontextprotocol/sdk/types.js"

import { startAndroidApp, getAndroidLogs } from "./android.js"
import { startIOSApp, getIOSLogs } from "./ios.js"

const server = new Server(
  {
    name: "mobile-debug-mcp",
    version: "0.1.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
)

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
          id: {
            type: "string",
            description: "Android package name or iOS bundle id"
          }
        },
        required: ["platform", "id"]
      }
    },
    {
      name: "get_logs",
      description: "Get recent logs from Android or iOS simulator",
      inputSchema: {
        type: "object",
        properties: {
          platform: {
            type: "string",
            enum: ["android", "ios"]
          },
          id: {
            type: "string",
            description: "Android package name or iOS bundle id"
          },
          lines: {
            type: "number",
            description: "Number of log lines (android only)"
          }
        },
        required: ["platform", "id"]
      }
    }
  ]
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    if (name === "start_app") {
      const { platform, id } = args as {
        platform: "android" | "ios"
        id: string
      }

      const result =
        platform === "android"
          ? await startAndroidApp(id)
          : await startIOSApp(id)

      return {
        content: [{ type: "text", text: result }]
      }
    }

    if (name === "get_logs") {
      const { platform, id, lines } = args as {
        platform: "android" | "ios"
        id: string
        lines?: number
      }

      const logs =
        platform === "android"
          ? await getAndroidLogs(id, lines ?? 200)
          : await getIOSLogs()

      return {
        content: [{ type: "text", text: logs }]
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