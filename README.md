# Mobile Debug MCP

**Mobile Debug MCP** is a minimal, secure MCP server for AI-assisted mobile development. It allows you to **launch Android or iOS apps**, **read their logs**, and **inspect UI** from an MCP-compatible AI client.

This server is designed with security in mind, using strict argument handling to prevent shell injection, and reliability, with robust process management to avoid hanging operations.

> **Note:** iOS support is currently an untested Work In Progress (WIP). Please use with caution and report any issues.

---

## Features

- Launch Android apps via package name.
- Launch iOS apps via bundle ID on a booted simulator.
- Fetch recent logs from Android or iOS apps.
- Terminate and restart apps.
- Clear app data for fresh installs.
- Capture screenshots.
- Cross-platform support (Android + iOS).
- Minimal, focused design for fast debugging loops.

---

## Requirements

- Node.js >= 18
- Android SDK (`adb` in PATH) for Android support
- Xcode command-line tools (`xcrun simctl`) for iOS support
- **iOS Device Bridge (`idb`)** for iOS UI tree support
- Booted iOS simulator for iOS testing

---

## Installation

You can install and use **Mobile Debug MCP** in one of two ways:

### 1. Install Dependencies

**iOS Prerequisite (`idb`):**
To use the `get_ui_tree` tool on iOS, you must install Facebook's `idb`:

```bash
brew tap facebook/fb
brew install idb-companion
pip3 install fb-idb
```

### 2. Clone the repository for local development

```bash
git clone https://github.com/YOUR_USERNAME/mobile-debug-mcp.git
cd mobile-debug-mcp
npm install
npm run build
```

This option is suitable if you want to modify or contribute to the code.

### 3. Install via npm for standard use

```bash
npm install -g mobile-debug-mcp
```

This option installs the package globally for easy use without cloning the repo.

---

## MCP Server Configuration

Example WebUI MCP config using `npx --yes` and environment variables:

```json
{
  "mcpServers": {
    "mobile-debug": {
      "command": "npx",
      "args": [
        "--yes",
        "mobile-debug-mcp",
        "server"
      ],
      "env": {
        "ADB_PATH": "/path/to/adb",
        "XCRUN_PATH": "/usr/bin/xcrun"
      }
    }
  }
}
```

> Make sure to set `ADB_PATH` (Android) and `XCRUN_PATH` (iOS) if the tools are not in your system PATH.

---

## Tools

All tools accept a JSON input payload and return a structured JSON response. **Every response includes a `device` object** (with information about the selected device/simulator used for the operation), plus the tool-specific output.

### start_app
Launch a mobile app.

**Input:**
```jsonc
{
  "platform": "android" | "ios",
  "appId": "com.example.app", // Android package or iOS bundle ID (Required)
  "deviceId": "emulator-5554" // Optional: target specific device/simulator
}
```

**Response:**
```json
{
  "device": { /* device info */ },
  "appStarted": true,
  "launchTimeMs": 123
}
```

### get_logs
Fetch recent logs from the app or device.

**Input:**
```jsonc
{
  "platform": "android" | "ios",
  "appId": "com.example.app", // Optional: filter logs by app
  "deviceId": "emulator-5554", // Optional: target specific device
  "lines": 200 // Optional: number of lines (Android only)
}
```

**Response:**
Returns two content blocks:
1. JSON metadata:
```json
{
  "device": { /* device info */ },
  "result": { "lines": 50, "crashLines": [...] }
}
```
2. Plain text log output.

### capture_screenshot
Capture a screenshot of the current device screen.

**Input:**
```jsonc
{
  "platform": "android" | "ios",
  "deviceId": "emulator-5554" // Optional: target specific device
}
```

**Response:**
Returns two content blocks:
1. JSON metadata:
```json
{
  "device": { /* device info */ },
  "result": { "resolution": { "width": 1080, "height": 1920 } }
}
```
2. Image content (image/png) containing the raw PNG data.

### terminate_app
Terminate a running app.

**Input:**
```jsonc
{
  "platform": "android" | "ios",
  "appId": "com.example.app", // Android package or iOS bundle ID (Required)
  "deviceId": "emulator-5554" // Optional
}
```

**Response:**
```json
{
  "device": { /* device info */ },
  "appTerminated": true
}
```

### restart_app
Restart an app (terminate then launch).

**Input:**
```jsonc
{
  "platform": "android" | "ios",
  "appId": "com.example.app", // Android package or iOS bundle ID (Required)
  "deviceId": "emulator-5554" // Optional
}
```

**Response:**
```json
{
  "device": { /* device info */ },
  "appRestarted": true,
  "launchTimeMs": 123
}
```

### reset_app_data
Clear app storage (reset to fresh install state).

**Input:**
```jsonc
{
  "platform": "android" | "ios",
  "appId": "com.example.app", // Android package or iOS bundle ID (Required)
  "deviceId": "emulator-5554" // Optional
}
```

**Response:**
```json
{
  "device": { /* device info */ },
  "dataCleared": true
}
```

### get_ui_tree
Get the current UI hierarchy from the device. Returns a structured JSON representation of the screen content.

**Input:**
```jsonc
{
  "platform": "android" | "ios",
  "deviceId": "emulator-5554" // Optional
}
```

**Response:**
```json
{
  "device": { /* device info */ },
  "screen": "",
  "resolution": { "width": 1080, "height": 1920 },
  "elements": [
    {
      "text": "Login",
      "contentDescription": null,
      "type": "android.widget.Button",
      "resourceId": "com.example:id/login_button",
      "clickable": true,
      "enabled": true,
      "visible": true,
      "bounds": [120,400,280,450],
      "center": [200, 425],
      "depth": 1,
      "parentId": 0,
      "children": []
    }
  ]
}
```

---

## Recommended Workflow

1. Ensure Android device or iOS simulator is running.
2. Use `start_app` to launch the app.
3. Use `get_logs` to read the latest logs.
4. Use `capture_screenshot` to visually inspect the app if needed.
5. Use `reset_app_data` to clear state if debugging fresh install scenarios.
6. Use `restart_app` to quickly reboot the app during development cycles.

---

## Notes

- Ensure `adb` and `xcrun` are in your PATH or set `ADB_PATH` / `XCRUN_PATH` accordingly.
- For iOS, the simulator must be booted before using tools.
- The `capture_screenshot` tool returns a multi-block response: a JSON text block with metadata, followed by an image block containing the base64-encoded PNG data.

---

## Testing

The repository includes a smoke test script to verify end-to-end functionality on real devices or simulators.

```bash
# Run smoke test for Android
npx tsx smoke-test.ts android com.example.package

# Run smoke test for iOS
npx tsx smoke-test.ts ios com.example.bundleid
```

The smoke test performs the following sequence:
1. Starts the app
2. Captures a screenshot
3. Fetches logs
4. Terminates the app

---

## License

MIT License
