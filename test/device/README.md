Device-dependent integration tests

Overview

This folder contains integration tests that require a simulator or a real device (Android/iOS). These tests exercise real device flows (install, start, UI-tree, logs, interaction) and are intentionally gated from the default CI to avoid failures on runners without devices.

Prerequisites

- Build the project: npm run build
- Android: adb available (set ADB_PATH if custom) and a connected device or emulator
- iOS: idb (fb-idb) and idb_companion installed and available. Prefer setting MCP_IDB_PATH or IDB_PATH, or add `idb` to PATH. For simulator tests ensure a simulator is booted.

Environment variables

- RUN_DEVICE_TESTS=true  — enable device tests when running the integration runner
- ADB_PATH — custom path to adb (optional)
- MCP_IDB_PATH / IDB_PATH — path to idb CLI (optional)
- DEVICE_ID — when a test requires a device id
- APP_ID — when a test requires an app package/bundle id (used by some scripts)

How to run

- Run all non-device integration tests (default):
  npm run test:integration

- Run device tests (all):
  RUN_DEVICE_TESTS=true npm run test:integration

- Run a single device test (example: iOS UI tree):
  npx tsx test/device/observe/test-ui-tree.ts ios booted

- Run install integration for a project:
  npx tsx test/device/manage/install.integration.ts /path/to/project [deviceId]

iOS notes

- If using idb_companion, prefer starting it bound to a UDID to reduce flakiness:
  idb_companion --udid <UDID> &
- Boot a simulator if needed:
  xcrun simctl boot <UDID>

Android notes

- Ensure an emulator or device is connected (adb devices)
- Some tests read DEVICE_ID or accept it as an argument

CI recommendation

Keep these tests gated behind RUN_DEVICE_TESTS and run them only on macOS runners (for iOS) or self-hosted runners with attached devices.
