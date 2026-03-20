# Manage (build & device management)

This document covers tools that perform project builds, device selection and lifecycle operations (install/start/terminate/restart/reset).

## list_devices
Enumerate connected Android devices and iOS simulators.

Input (optional):

```json
{ "platform": "android" }
```

Response:

```json
{ "devices": [ { "id": "emulator-5554", "platform": "android", "osVersion": "11", "model": "sdk_gphone64_arm64", "simulator": true, "appInstalled": false } ] }
```

Notes:
- When multiple devices are attached, pass `deviceId` to other tools to target a specific device.

---

## build_app / build_android / build_ios
Build a project and return the path to the generated artifact (APK or .app/.ipa).

Input (examples):

Android:

```json
{ "projectPath": "/path/to/project", "gradleTask": "assembleDebug", "maxWorkers": 4 }
```

iOS:

```json
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

## build_flutter / build_react_native
Framework-specific helpers. These are best-effort and may delegate to native subprojects when necessary.

Input (flutter example):

```json
{ "projectPath": "/path/to/flutter", "platform": "android", "buildMode": "debug" }
```

Response:

```
{ "artifactPath": "/path/to/build/output/app.apk" }
```

Notes:
- Flutter: prefers `FLUTTER_PATH` or `flutter` on PATH; iOS builds may require codesigning and CocoaPods.
- React Native: delegates to android/ios subprojects; run `pod install` in CI before iOS builds.

---

## build_and_install (buildAndInstallHandler)
Orchestrates build then install and returns streamed NDJSON events and a final result object.

Input:

```json
{ "projectPath": "/path/to/project", "platform": "android", "deviceId": "emulator-5554", "projectType": "kmp" }
```

NDJSON events (example stream):

```json
{"type":"build","status":"started","platform":"android"}
{"type":"build","status":"finished","artifactPath":"/path/to/app.apk"}
{"type":"install","status":"started","artifactPath":"/path/to/app.apk","deviceId":"emulator-5554"}
{"type":"install","status":"finished","artifactPath":"/path/to/app.apk","device":{"platform":"android","id":"emulator-5554"}}
```

Final result:

```json
{ "success": true, "artifactPath": "/path/to/app.apk", "device": { "platform": "android", "id": "emulator-5554" }, "output": "Performing Streamed Install\nSuccess" }
```

Notes:
- If `projectType` === `kmp`, the handler prefers Android by default. Set `platform` explicitly to override.
- If `MCP_DISABLE_AUTODETECT=1`, callers MUST provide `platform` or `projectType`.

---

## install_app
Install an app onto a connected device or simulator.

Input:

```json
{ "platform": "android", "appPath": "/path/to/app.apk", "deviceId": "emulator-5554" }
```

Response:

```json
{ "device": { "platform": "android", "id": "emulator-5554" }, "installed": true, "output": "Performing Streamed Install\nSuccess" }
```

Notes:
- Android: prefers `ADB_PATH` if set, otherwise falls back to `adb` on PATH.
- iOS: uses `xcrun simctl install` for simulators and `idb` where available for devices.

---

## start_app / terminate_app / restart_app / reset_app_data
Standard app lifecycle operations.

start_app input example:

```json
{ "platform": "android", "appId": "com.example.app", "deviceId": "emulator-5554" }
```

start_app response example:

```json
{ "device": { "platform": "android", "id": "emulator-5554" }, "appStarted": true, "launchTimeMs": 142 }
```

