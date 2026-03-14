# Tools

This document contains detailed definitions for each MCP tool implemented by Mobile Debug MCP. These were extracted from the README to keep the top-level README concise.

Each tool returns a JSON metadata block and, where applicable, additional content blocks (e.g., image data or raw logs). Where an example previously used `jsonc` fences with inline comments, the examples below use `json` fences and external explanatory notes to avoid highlighting issues.

---

## list_devices
Enumerate connected Android devices and iOS simulators.

Input (optional):
```json
{ "platform": "android" | "ios" }
```

Response:
```json
{ "devices": [ { "id": "emulator-5554", "platform": "android", "osVersion": "11", "model": "sdk_gphone64_arm64", "simulator": true, "appInstalled": false } ] }
```

Notes:
- Use `list_devices` to inspect connected targets and their metadata. When multiple devices are attached, pass `deviceId` to other tools to target a specific device.

---

## install_app
Install an app onto a connected device or simulator (APK for Android, .app/.ipa for iOS).

Input:
```json
{
  "platform": "android" | "ios",
  "appPath": "/path/to/app.apk_or_app.app_or_ipa",
  "deviceId": "emulator-5554"
}
```

Response:
```json
{
  "device": { /* device info */ },
  "installed": true,
  "output": "Platform-specific installer output (adb/simctl/idb)",
  "error": "Optional error message if installation failed"
}
```

Notes:
- Android: the tool attempts to locate and install the APK. If `appPath` points at a project directory, the tool will attempt to run the Gradle wrapper (`./gradlew assembleDebug`) and locate the built APK under `build/outputs/apk/`.
- The installer respects `ADB_PATH` (preferred) falling back to `adb` on PATH. To avoid PATH discovery issues, set `ADB_PATH` to the full adb binary path.
- The default ADB command timeout was increased to 120s to handle larger streamed installs. Configure via `MCP_ADB_TIMEOUT` or `ADB_TIMEOUT` env vars.
- iOS: prefers `xcrun simctl install` for simulators and falls back to `idb install` for devices when available.

---

## start_app
Launch a mobile app.

Input:
```json
{
  "platform": "android" | "ios",
  "appId": "com.example.app",
  "deviceId": "emulator-5554"
}
```

Response:
```json
{
  "device": { /* device info */ },
  "appStarted": true,
  "launchTimeMs": 123
}
```

Notes:
- Android: uses `adb shell monkey -p <package> -c android.intent.category.LAUNCHER 1` to trigger a launch.
- iOS: uses `xcrun simctl launch` for simulators or `idb` for devices when available.

---

## get_logs
Fetch recent logs from the app or device.

Input:
```json
{
  "platform": "android" | "ios",
  "appId": "com.example.app",
  "deviceId": "emulator-5554",
  "lines": 200
}
```

Response:
- The tool returns two content blocks for Android: a JSON metadata block and a plain text log output block. The JSON metadata includes parsed results (counts, crash summaries) and the raw log is provided for inspection.

Notes:
- Android log parsing is heuristic and includes basic crash detection (searching for "FATAL EXCEPTION" and exception names).
- Use `lines` to control how many log lines are returned from `adb logcat`.

---

## capture_screenshot
Capture a screenshot of the current device screen.

Input:
```json
{
  "platform": "android" | "ios",
  "deviceId": "emulator-5554"
}
```

Response:
- JSON metadata block with resolution and device info, followed by an image/png block containing base64-encoded PNG bytes.

Notes:
- Android: uses `adb exec-out screencap -p` and returns PNG bytes.
- iOS: uses `xcrun simctl io booted screenshot` or `idb` capture when available.

---

## terminate_app
Terminate a running app.

Input:
```json
{
  "platform": "android" | "ios",
  "appId": "com.example.app",
  "deviceId": "emulator-5554"
}
```

Response:
```json
{ "device": { /* device info */ }, "appTerminated": true }
```

Notes:
- Android: uses `adb shell am force-stop <package>`.

---

## restart_app
Restart an app (terminate then launch).

Input/Response: combination of terminate + start as above. Response includes launch timing metadata.

---

## reset_app_data
Clear app storage (reset to fresh install state).

Input:
```json
{
  "platform": "android" | "ios",
  "appId": "com.example.app",
  "deviceId": "emulator-5554"
}
```

Response:
```json
{ "device": { /* device info */ }, "dataCleared": true }
```

Notes:
- Android: uses `adb shell pm clear <package>` and returns whether the operation succeeded.

---

## start_log_stream / read_log_stream / stop_log_stream
Start a live log stream (background) for an Android app and poll the accumulated entries.

- start_log_stream starts a background `adb logcat` filtered by the app PID and writes parsed NDJSON to a per-session file. Returns immediately with session details.
- read_log_stream retrieves recent parsed entries and includes crash detection metadata.
- stop_log_stream terminates the background process and closes the stream.

Input (start_log_stream):
```json
{ "packageName": "com.example.app", "level": "error" | "warn" | "info" | "debug", "sessionId": "optional-session-id" }
```

Response (read_log_stream):
```json
{ "entries": [ /* parsed entries */ ], "crash_summary": { "crash_detected": true/false, "exception": "..." } }
```

Notes:
- The `since` parameter for read_log_stream accepts ISO timestamps or epoch ms. Use it for incremental polling.
- Crash detection is heuristic-based and intended as a quick signal for agents.

---

## get_ui_tree
Get the current UI hierarchy from the device.

Input:
```json
{ "platform": "android" | "ios", "deviceId": "emulator-5554" }
```

Response:
- Structured JSON containing screen metadata and an array of UI elements with properties: text, contentDescription, type, resourceId, clickable, enabled, visible, bounds, center, depth, parentId, children.

Notes:
- Android: uses `uiautomator dump` or `adb exec-out uiautomator` fallback methods. Times out on slow responses; use provided timeouts.
- iOS: uses `idb` or accessibility APIs when available.

---

## get_current_screen
Get the currently visible activity on Android.

Input:
```json
{ "deviceId": "emulator-5554" }
```

Response:
```json
{ "device": { /* device info */ }, "package": "com.example.app", "activity": "com.example.app.LoginActivity", "shortActivity": "LoginActivity" }
```

Notes:
- Uses `dumpsys activity activities` and robust parsing to support multiple Android versions.

---

## wait_for_element
Wait until a UI element with matching text appears on screen or timeout is reached.

Input:
```json
{ "platform": "android" | "ios", "text": "Home", "timeout": 5000, "deviceId": "emulator-5554" }
```

Response:
```json
{ "device": { /* device info */ }, "found": true/false, "element": { /* element */ } }
```

Notes:
- Polls get_ui_tree until timeout or element found. Returns an `error` field if system failures occur.

---

## tap / swipe / type_text / press_back

- tap: `adb shell input tap x y` (Android) or `idb` events for iOS.
- swipe: `adb shell input swipe x1 y1 x2 y2 duration`.
- type_text: `adb shell input text` (spaces encoded as %s) — may fail for special characters.
- press_back: `adb shell input keyevent 4`.

Inputs and responses follow the device+success pattern used across other tools.

---

## Notes on environment and timeout behavior

- The tools prefer explicit env vars: `ADB_PATH` and `XCRUN_PATH` to locate platform binaries. If unset, tools fall back to PATH lookup.
- For Android builds, the install tool auto-detects a suitable Java 17 installation (Android Studio JBR or system JDK 17). Any JAVA_HOME overrides are scoped to the spawned Gradle process.
- Default ADB timeout is now 120s for long operations; override via `MCP_ADB_TIMEOUT` or `ADB_TIMEOUT`.

---

If you need the tools split into per-tool markdown files (e.g., docs/tools/install.md), say so and I will split them.
