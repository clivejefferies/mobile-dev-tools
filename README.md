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

### list_devices
Enumerate connected Android devices and iOS simulators.

Input (optional):
```jsonc
{ "platform": "android" | "ios" }
```

Response:
```json
{ "devices": [ { "id": "emulator-5554", "platform": "android", "osVersion": "11", "model": "sdk_gphone64_arm64", "simulator": true, "appInstalled": false } ] }
```

Use `list_devices` when multiple devices are attached to inspect metadata and pick a device explicitly by passing `deviceId` to subsequent tool calls.

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

### install_app
Install an app onto a connected device or simulator (APK for Android, .app/.ipa for iOS).

**Input:**
```jsonc
{
  "platform": "android" | "ios",
  "appPath": "/path/to/app.apk_or_app.app_or_ipa", // Host path to the app file (Required)
  "deviceId": "emulator-5554" // Optional: target specific device/simulator
}
```

**Response:**
```json
{
  "device": { /* device info */ },
  "installed": true,
  "output": "Platform-specific installer output (adb/simctl/idb)",
  "error": "Optional error message if installation failed"
}
```

Notes:
- Android: uses `adb install -r <apkPath>`. The APK must be accessible from the host running the MCP server.
- iOS: attempts `xcrun simctl install` for simulators and falls back to `idb install` if available for physical devices. Ensure `XCRUN_PATH` and `IDB` are configured if using non-standard locations.
- Installation output and errors are surfaced in the response for debugging.

### start_log_stream / read_log_stream / stop_log_stream
Start a live log stream for an Android app and poll the accumulated entries.

start_log_stream starts a background adb logcat process filtered by the app PID. It returns immediately with success and creates a per-session NDJSON file of parsed log entries.

read_log_stream retrieves recent parsed entries and includes crash detection metadata.

Input (start_log_stream):
```jsonc
{
  "packageName": "com.example.app", // Required
  "level": "error" | "warn" | "info" | "debug", // Optional, defaults to "error"
  "sessionId": "optional-session-id" // Optional - used to track stream per debugging session
}
```

Input (read_log_stream):
```jsonc
{
  "sessionId": "optional-session-id",
  "limit": 100, // Optional, max number of entries to return (default 100)
  "since": "2026-03-13T14:00:00Z" // Optional, ISO timestamp or epoch ms to return only newer entries
}
```

Response (read_log_stream):
```json
{
  "entries": [
    { "timestamp": "2026-03-13T14:01:04.123Z", "level": "E", "tag": "AndroidRuntime", "message": "FATAL EXCEPTION: main", "crash": true, "exception": "NullPointerException" }
  ],
  "crash_summary": { "crash_detected": true, "exception": "NullPointerException", "sample": "FATAL EXCEPTION: main" }
}
```

Notes:
- The read_log_stream `since` parameter accepts ISO timestamps or epoch milliseconds. Use it to poll incrementally (pass last seen timestamp).
- Crash detection is heuristic-based (looks for 'FATAL EXCEPTION' and Exception names). It helps agents decide to capture traces or stop tests quickly.
- stop_log_stream stops the background adb process for the session.


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

### get_current_screen
Get the currently visible activity on an Android device.

**Input:**
```jsonc
{
  "deviceId": "emulator-5554" // Optional: target specific device
}
```

**Response:**
```json
{
  "device": { /* device info */ },
  "package": "com.example.app",
  "activity": "com.example.app.LoginActivity",
  "shortActivity": "LoginActivity"
}
```

### wait_for_element
Wait until a UI element with matching text appears on screen or timeout is reached. Useful for handling loading states or transitions.

**Input:**
```jsonc
{
  "platform": "android" | "ios",
  "text": "Home", // Text to wait for
  "timeout": 5000, // Max wait time in ms (default 10000)
  "deviceId": "emulator-5554" // Optional
}
```

**Response:**
```json
{
  "device": { /* device info */ },
  "found": true,
  "element": { /* UIElement object if found */ }
}
```

If the element is not found within the timeout, `found` will be `false`. If a system error occurs (e.g., ADB failure), an `error` field will be present.

```json
{
  "device": { /* device info */ },
  "found": false,
  "error": "Optional error message"
}
```

### tap
Simulate a finger tap on the device screen at specific coordinates.

Platform support and constraints:
- Android: Implemented via `adb shell input tap` and works when `adb` is available in PATH or configured via `ADB_PATH`.
- iOS: Requires Facebook's `idb` tooling. The iOS implementation uses `idb` to deliver UI events and is simulator-oriented (works reliably on a booted simulator). Physical device support depends on `idb` capabilities and a running `idb_companion` on the target device; it may not work in all environments.

Prerequisites for iOS (if you intend to use tap on iOS):
```bash
brew tap facebook/fb
brew install idb-companion
pip3 install fb-idb
```
Ensure `idb` and `idb_companion` are in your PATH. If you use non-standard tool locations, set `XCRUN_PATH` and/or `ADB_PATH` environment variables as appropriate.

Behavior notes:
- The tool is a primitive input: it only sends a tap at the provided coordinates. It does not inspect or interpret the UI.
- If `idb` is missing or the simulator/device is not available, the tool will return an error explaining the failure.

**Input:**
```jsonc
{
  "platform": "android" | "ios", // Optional, defaults to "android"
  "x": 200, // X coordinate (Required)
  "y": 400, // Y coordinate (Required)
  "deviceId": "emulator-5554" // Optional
}
```

**Response:**
```json
{
  "device": { /* device info */ },
  "success": true,
  "x": 200,
  "y": 400
}
```

If the tap fails (e.g., missing `adb`/`idb`, device not found), `success` will be `false` and an `error` field will be present.

### swipe
Simulate a swipe gesture on an Android device.

**Input:**
```jsonc
{
  "platform": "android", // Optional, defaults to "android"
  "x1": 500, // Start X (Required)
  "y1": 1500, // Start Y (Required)
  "x2": 500, // End X (Required)
  "y2": 500, // End Y (Required)
  "duration": 300, // Duration in ms (Required)
  "deviceId": "emulator-5554" // Optional
}
```

**Response:**
```json
{
  "device": { /* device info */ },
  "success": true,
  "start": [500, 1500],
  "end": [500, 500],
  "duration": 300
}
```

If the swipe fails, `success` will be `false` and an `error` field will be present.

### type_text
Type text into the currently focused input field on an Android device.

**Input:**
```jsonc
{
  "platform": "android", // Optional, defaults to "android"
  "text": "hello world", // Text to type (Required)
  "deviceId": "emulator-5554" // Optional
}
```

**Response:**
```json
{
  "device": { /* device info */ },
  "success": true,
  "text": "hello world"
}
```

If the command fails, `success` will be `false` and an `error` field will be present.

### press_back
Simulate pressing the Android Back button.

**Input:**
```jsonc
{
  "platform": "android", // Optional
  "deviceId": "emulator-5554" // Optional
}
```

**Response:**
```json
{
  "device": { /* device info */ },
  "success": true
}
```

---

## Recommended Workflow

1. Ensure Android device or iOS simulator is running.
2. Use `start_app` to launch the app.
3. Use `get_logs` to read the latest logs.
4. Use `capture_screenshot` to visually inspect the app if needed.
5. Use `wait_for_element` to ensure the app is in the expected state before proceeding (e.g., after login).
6. Use `reset_app_data` to clear state if debugging fresh install scenarios.
7. Use `restart_app` to quickly reboot the app during development cycles.

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
