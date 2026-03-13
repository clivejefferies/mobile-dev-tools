# Changelog

All notable changes to the **Mobile Debug MCP** project will be documented in this file.

## [0.8.0]

### Added
- **`list_devices` tool**: enumerate connected Android devices and iOS simulators. Returns device metadata (id, platform, osVersion, model, simulator, appInstalled).
- **`install_app` tool**: install an APK (.apk) on Android or an app bundle (.app/.ipa) on iOS simulators/devices. Uses `adb install -r` for Android and `simctl`/`idb` for iOS.
- **`start_log_stream`, `read_log_stream`, `stop_log_stream` tools**: stream Android logcat filtered by application PID, poll parsed entries, support incremental reads (limit/since) and basic crash detection metadata (crash_detected, exception, sample).

### Changed
- Device-selection: server handlers now use a central resolver to pick a sensible default device when `deviceId` is omitted. This reduces duplication and makes behavior deterministic when multiple devices are attached.

## [0.7.0]

### Added
- **`wait_for_element` tool**: Added ability to wait for a specific UI element to appear on screen. Polls `get_ui_tree` until timeout. Useful for waiting on app transitions or loading states.
- **`get_current_screen` tool**: Added ability to determine the currently visible activity on an Android device using `dumpsys activity activities`. Includes robust regex parsing to handle various Android versions.
- **`tap` tool**: Added ability to tap at specific screen coordinates on Android and iOS devices.
- **`swipe` tool**: Added ability to simulate swipe gestures (scroll, drag) on Android devices.
- **`type_text` tool**: Added ability to type text into focused input fields on Android devices.
- **`press_back` tool**: Added ability to simulate the Android Back button.

## [0.4.0]

### Added
- **`terminate_app` tool**: Added ability to terminate apps on Android and iOS.
- **`restart_app` tool**: Added ability to restart apps (terminate + launch) in a single command.
- **`reset_app_data` tool**: Added ability to clear app data/storage for fresh install testing.
- **Unified `capture_screenshot` tool**: Replaces `capture_android_screen` and `capture_ios_screenshot` with a single cross-platform tool. Returns both metadata and image data.
- **Environment Configuration**: Added support for `XCRUN_PATH` to configure iOS tools path (alongside existing `ADB_PATH`).
- **Smoke Test**: Added `smoke-test.ts` for end-to-end verification of toolchain.

### Security
- **Shell Injection Prevention**: Refactored Android and iOS tools to use `execFile` with argument arrays instead of string concatenation, preventing potential shell injection attacks via malicious app IDs or inputs.

### Changed
- **Response Format**: Updated all tools to return JSON metadata within `text` content blocks (instead of invalid `application/json` type) to comply with MCP spec.
- **iOS Device Metadata**: `get_logs` and `capture_screenshot` now return real device metadata (OS version, model) from the booted simulator instead of hardcoded values.
- **Android Logging**: Improved `get_logs` reliability by removing dependency on `pidof` (which caused hangs) and using robust string-based filtering. Added timeouts to prevent infinite hangs.
- **Docs**: Updated `README.md` with new tools and workflow recommendations.
- **Docs**: Created `.github/copilot-instructions.md` to assist AI agents.
