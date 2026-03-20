# Tools

This document contains detailed definitions for each MCP tool implemented by Mobile Debug MCP. Examples use valid JSON in fenced code blocks to avoid highlighting issues.

---

## Summary of build/install handlers

- buildApp / build_android / build_ios: platform-specific build handlers that run Gradle or xcodebuild and return an artifact path.
- buildAndInstallHandler: orchestrates build → install → validate and emits NDJSON events for progress.
- build_flutter / build_react_native: best-effort handlers that prefer framework CLIs (flutter) or delegate to native subprojects for React Native.

Environment variables you may need:
- ADB_PATH: explicit path to adb binary (recommended for non-interactive shells)
- XCRUN_PATH / IDB_PATH: explicit xcrun/idb path overrides
- FLUTTER_PATH: explicit flutter CLI path (optional)
- MCP_GRADLE_WORKERS / MCP_BUILD_JOBS: number of Gradle/Xcode workers
- MCP_GRADLE_CACHE: set to "0" to disable Gradle build cache
- MCP_DERIVED_DATA: path for Xcode -derivedDataPath (improves incremental iOS builds)
- MCP_FORCE_CLEAN / MCP_FORCE_CLEAN_ANDROID / MCP_FORCE_CLEAN_IOS: control clean behavior
- MCP_DISABLE_AUTODETECT: set to "1" to disable project auto-detection (require explicit platform or projectType)

---

## list_devices
Enumerate connected Android devices and iOS simulators.

Input (optional):

```
{ "platform": "android" }
```

Response:

```
{ "devices": [ { "id": "emulator-5554", "platform": "android", "osVersion": "11", "model": "sdk_gphone64_arm64", "simulator": true, "appInstalled": false } ] }
```

Notes:
- When multiple devices are attached, pass `deviceId` to other tools to target a specific device.

---

## build_app / build_android / build_ios
Build a project and return the path to the generated artifact (APK or .app/.ipa).

Input (examples):

Android:

```
{ "projectPath": "/path/to/project", "gradleTask": "assembleDebug", "maxWorkers": 4 }
```

iOS:

```
{ "projectPath": "/path/to/project", "scheme": "AppScheme", "derivedDataPath": "/tmp/derived", "buildJobs": 4 }
```

Response:

```
{ "artifactPath": "/path/to/build/output/app.apk" }
```

Notes:
- Android: honors `MCP_GRADLE_WORKERS` / `MCP_GRADLE_CACHE`; will prefer project gradlew when present.
- iOS: honors `MCP_DERIVED_DATA`, `MCP_BUILD_JOBS` and `MCP_XCODE_DESTINATION_UDID`.

---

## build_flutter
Best-effort Flutter build. Prefers `flutter` CLI when available, otherwise delegates to native subprojects.

Input:

```
{ "projectPath": "/path/to/flutter", "platform": "android", "buildMode": "debug" }
```

Response:

```
{ "artifactPath": "/path/to/build/output/app.apk" }
```

Notes:
- iOS builds may require codesigning and CocoaPods. The handler uses `--no-codesign` where appropriate but CI must provide signing artifacts if needed.

---

## build_react_native
Delegates to native subproject builders (android/ios). Does not run `pod install`; pre-install pods in CI for deterministic builds.

Input:

```
{ "projectPath": "/path/to/react-native", "platform": "android" }
```

Response:

```
{ "artifactPath": "/path/to/android/app/build/outputs/apk/debug/app-debug.apk" }
```

---

## build_and_install (buildAndInstallHandler)
Orchestrates build then install and returns streamed NDJSON events and a final result object.

Input:

```
{ "projectPath": "/path/to/project", "platform": "android", "deviceId": "emulator-5554", "projectType": "kmp" }
```

NDJSON events (example stream):

```
{"type":"build","status":"started","platform":"android"}
{"type":"build","status":"finished","artifactPath":"/path/to/app.apk"}
{"type":"install","status":"started","artifactPath":"/path/to/app.apk","deviceId":"emulator-5554"}
{"type":"install","status":"finished","artifactPath":"/path/to/app.apk","device":{"platform":"android","id":"emulator-5554"}}
```

Final result:

```
{ "success": true, "artifactPath": "/path/to/app.apk", "device": { "platform": "android", "id": "emulator-5554" }, "output": "Performing Streamed Install\nSuccess" }
```

Notes:
- If `projectType` === `kmp`, the handler prefers Android by default. Set `platform` explicitly to override.
- If `MCP_DISABLE_AUTODETECT=1`, callers MUST provide `platform` or `projectType`.

---

## install_app
Install an app onto a connected device or simulator.

Input:

```
{ "platform": "android", "appPath": "/path/to/app.apk", "deviceId": "emulator-5554" }
```

Response:

```
{ "device": { "platform": "android", "id": "emulator-5554" }, "installed": true, "output": "Performing Streamed Install\nSuccess" }
```

Notes:
- Android: prefers `ADB_PATH` if set, otherwise falls back to `adb` on PATH.
- iOS: uses `xcrun simctl install` for simulators and `idb` where available for devices.

---

## start_app / terminate_app / restart_app / reset_app_data
Standard app lifecycle operations.

start_app input:

```
{ "platform": "android", "appId": "com.example.app", "deviceId": "emulator-5554" }
```

start_app response:

```
{ "device": { "platform": "android", "id": "emulator-5554" }, "appStarted": true, "launchTimeMs": 142 }
```

terminate_app response:

```
{ "device": { "platform": "android", "id": "emulator-5554" }, "appTerminated": true }
```

reset_app_data response:

```
{ "device": { "platform": "android", "id": "emulator-5554" }, "dataCleared": true }
```

---

## get_logs
Fetch recent logs. For Android returns metadata + raw log block.

Input:

```
{ "platform": "android", "appId": "com.example.app", "deviceId": "emulator-5554", "lines": 200 }
```

Response (metadata):

```
{ "entries": 200, "crash_summary": { "crash_detected": false } }
```

Followed by raw log plain text block.

---

## capture_screenshot
Capture screen. Returns JSON metadata then an image/png block with base64 PNG data.

Input:

```
{ "platform": "android", "deviceId": "emulator-5554" }
```

Response (metadata):

```
{ "device": { "platform": "android", "id": "emulator-5554" }, "width": 1080, "height": 2400 }
```

---

## get_ui_tree
Returns parsed UI hierarchy.

Input:

```
{ "platform": "android", "deviceId": "emulator-5554" }
```

Response (example):

```
{ "device": { "platform": "android", "id": "emulator-5554" }, "elements": [ { "text": "Sign in", "type": "android.widget.Button", "resourceId": "com.example:id/signin", "clickable": true, "bounds": [0,0,100,50] } ] }
```

---

## get_current_screen
Get visible Android activity.

Input:

```
{ "deviceId": "emulator-5554" }
```

Response:

```
{ "device": { "platform": "android", "id": "emulator-5554" }, "package": "com.example.app", "activity": "com.example.app.MainActivity", "shortActivity": "MainActivity" }
```

---

## wait_for_element
Wait for UI element.

Input:

```
{ "platform": "android", "text": "Home", "timeout": 5000, "deviceId": "emulator-5554" }
```

Response:

```
{ "device": { "platform": "android", "id": "emulator-5554" }, "found": true, "element": { "text": "Home", "resourceId": "com.example:id/home" } }
```

---

## tap / swipe / type_text / press_back

Examples:

Tap input:

```
{ "platform": "android", "deviceId": "emulator-5554", "x": 100, "y": 200 }
```

Response:

```
{ "device": { "platform": "android", "id": "emulator-5554" }, "success": true }
```

---

## start_log_stream / read_log_stream / stop_log_stream
Start a background adb logcat stream and retrieve parsed NDJSON entries.

start_log_stream input:

```
{ "packageName": "com.example.app", "level": "error", "sessionId": "optional" }
```

read_log_stream response:

```
{ "entries": [ { "timestamp": "2026-03-20T...Z", "level": "E", "tag": "AppTag", "message": "FATAL EXCEPTION" } ], "crash_summary": { "crash_detected": true } }
```

---

## Notes on environment and timeouts

- Prefer explicit env vars: `ADB_PATH`, `XCRUN_PATH`, `IDB_PATH`, `FLUTTER_PATH` for deterministic agent runs.
- Use `MCP_DERIVED_DATA` to reuse DerivedData for fast incremental iOS builds.
- For CI/agents, set `MCP_DISABLE_AUTODETECT=1` and provide `platform` or `projectType` to avoid ambiguous behavior.
- Default ADB timeout is 120s; override via `MCP_ADB_TIMEOUT` or `ADB_TIMEOUT`.

---

If you want per-tool split files, I can split this document into smaller files under docs/tools/.
