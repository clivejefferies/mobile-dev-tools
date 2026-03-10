# Copilot Instructions for mobile-debug-mcp

## Build and Run
- **Build**: `npm run build` (runs `tsc` to compile TypeScript to `dist/`)
- **Start**: `npm start` (runs the compiled server at `dist/server.js`)
- **Dev Workflow**: modify `src/*.ts` -> `npm run build` -> `npm start` to test changes.

## Architecture
- **Core**: `src/server.ts` implements the MCP server using `@modelcontextprotocol/sdk`. It handles tool registration and execution.
- **Platform Modules**:
  - `src/android.ts`: Encapsulates `adb` commands for Android device interaction.
  - `src/ios.ts`: Encapsulates `xcrun simctl` commands for iOS simulator interaction.
- **Types**: `src/types.ts` defines shared interfaces for device info and tool responses.

## Key Conventions

### Tool Implementation
- **Response Format**: Tools typically return a list of content blocks.
  - `start_app`: Returns a single text block containing JSON (via `wrapResponse`).
  - `terminate_app`: Returns a single text block containing JSON (via `wrapResponse`).
  - `restart_app`: Returns a single text block containing JSON (via `wrapResponse`).
  - `reset_app_data`: Returns a single text block containing JSON (via `wrapResponse`).
  - `get_logs`: Returns a text block (JSON metadata) AND a text block (raw logs).
  - `capture_screenshot`: Returns a text block (JSON metadata) AND an image block (base64 PNG).
- **Metadata**: Always include a `device` object (platform, id, model, etc.) in the JSON response part.

### External Tools
- **Android**: Uses `process.env.ADB_PATH` or defaults to `adb`.
- **iOS**: Uses `process.env.XCRUN_PATH` or defaults to `xcrun`. Assumes a booted simulator.
- **Execution**: Uses `child_process.exec` for running shell commands.

### Error Handling
- Tools should catch execution errors and return a user-friendly error message in a `text` content block, rather than crashing the server.
