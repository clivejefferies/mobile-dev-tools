# Changelog

All notable changes to the **Mobile Debug MCP** project will be documented in this file.

## [0.4.0] - 2026-03-09

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
