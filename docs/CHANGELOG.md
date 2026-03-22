# Changelog

All notable changes to the **Mobile Debug MCP** project will be documented in this file.

## [0.13.0]
- Fixed a crash in the `start_app` tool by adding validation to ensure `appId` and `platform` are provided.

## [0.12.4]
- Made projectType and platform mandatory

## [0.12.3]
- Now supports native and cross platform development platforms for building
- Add MCP_DISABLE_AUTODETECT env var to require explicit platform/projectType for deterministic agent runs. When set to 1, build/install handlers will fail if platform is not provided.
- Add unit test covering MCP_DISABLE_AUTODETECT behaviour and ambiguous project detection (test/unit/manage/mcp_disable_autodetect.test.ts).
- Improve build_and_install handler to emit a clear NDJSON event when autodetect is disabled and platform was not supplied.


## [0.12.1]
- Improve iOS build/install reliability: project auto-scan, explicit simulator destination, configurable watchdog timeout (MCP_XCODEBUILD_TIMEOUT) and retries (MCP_XCODEBUILD_RETRIES), and DerivedData fallback for locating .app artifacts.
- Make install_app capable of building iOS projects before installing so agents can autonomously fix, build, install and validate apps.
- Migrate CLI scripts into typed src/cli/* modules and update npm scripts; fix ESM import paths and lint issues.
- Add preflight checks and idb resolution helpers (getIdbCmd, isIDBInstalled) and add idb_companion health checks.
- Capture build stdout/stderr into build-results/ for easier diagnostics and surfaced suggestions when KMP frameworks are missing.
- Add device test runner under test/device and gate device-dependent tests behind RUN_DEVICE_TESTS.


## [0.12.0]
- Add iOS idb integration: config-driven idb path resolution (MCP_IDB_PATH / MCP config / IDB_PATH), robust idb detection and parsing of `ui describe-all` output.
- Add reusable helpers: `isIDBInstalled()` and `getIdbCmd()` to centralise idb resolution and diagnostics.
- Ensure install_app can build binaries (xcodebuild / Gradle) before installing so agents can autonomously build, install and validate fixes.
- Add idb integration test (UI-tree + tap) and reorganise device-dependent tests under `test/device`.
- Gate device tests behind RUN_DEVICE_TESTS (device tests won't run in default CI); added `test:device` runner and updated npm scripts.
- Linting & tooling fixes: ESLint adjustments (ignore generated scripts), ESM entry fix for install-idb.ts, and various lint cleanups.
- Added `test/device/README.md` with device-test run instructions.


## [0.11.0]
- Tools refactor - broke functions into 3 distinct class types; interact (for UI manipulation), manage (for build, installing etc) and observe (observing the app whilst running)
- Add convenience method to build and install

## [0.10.0]

### Added / Changed
- Tools refactor: consolidated handlers into ToolsInteract and ToolsObserve classes to centralise tool wiring and simplify platform delegation.
- install_app now builds project directories (Gradle/xcodebuild) and supports streamed installs with robust fallbacks (adb push + pm install).
- Added log streaming utilities and improved log parsing/crash detection heuristics.
- CI: added lint and unit tests for handler parity; updated README links to docs and changelog.
- Docs: Created docs/TOOLS.md with comprehensive tool definitions and examples.


## [0.9.0] 

### Added / Changed
- install_app now builds apps when given a project directory and then installs the produced artifact (Android: Gradle wrapper assembleDebug; iOS: xcodebuild where applicable). When a workspace (.xcworkspace) is present, the iOS build uses `-workspace` instead of `-project` to support CocoaPods and multi-project setups.
- Build orchestration uses a scoped JAVA_HOME (detectJavaHome) and prefers JDK 17 when available; Gradle invocations avoid mutating global env and pass java home via `-Dorg.gradle.java.home`.
- Streaming ADB support: added `spawnAdb()` (streams stdout/stderr and returns exit code) alongside `execAdb()` (returns buffered stdout). This enables live install output and robust fallbacks.
- Resilient install flow: streamed `adb install` is attempted first; on failure MCP falls back to `adb push` + `pm install -r` to improve reliability on devices that don't support streamed install or when install times out.
- Centralised timeout logic: extracted `getAdbTimeout(args, customTimeout)` to standardise timeout selection (precedence: custom timeout > MCP_ADB_TIMEOUT/ADB_TIMEOUT env > per-command defaults — install: 120s, logcat: 10s, uiautomator dump: 20s).
- Improved types: `execAdb` / `spawnAdb` now accept `SpawnOptionsWithTimeout` (typed extension of Node's SpawnOptions with an optional timeout property).
- Linting and CI: added ESLint (unused-imports plugin), added `npm run lint` / `npm run lint:fix` scripts, and updated CI to run lint in the unit job. ESLint config converted to the flat `eslint.config.js` format.
- Tests: unit tests updated to exercise real build/install flows using fake `adb` and `gradlew` wrappers; added detectJavaHome smoke tests. Integration workflows remain manual and require device/emulator access.
- Misc: improved logging, more informative error messages, and several internal cleanups (removed redundant try/catch, consolidated helper functions).


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
