# Mobile Debug MCP

A minimal, secure MCP server for AI-assisted mobile development. Build, install, and inspect Android/iOS apps from an MCP-compatible client.

This README was shortened to keep high-level info only. Detailed tool definitions moved to docs/TOOLS.md.

## Quick start

```bash
git clone https://github.com/YOUR_USERNAME/mobile-debug-mcp.git
cd mobile-debug-mcp
npm install
npm run build
npm start
```

## Requirements

- Node.js >= 18
- Android SDK (adb) for Android support
- Xcode command-line tools for iOS support
- Optional: idb for enhanced iOS device support

## Configuration example

```json
{
  "mcpServers": {
    "mobile-debug": {
      "command": "npx",
      "args": ["--yes","mobile-debug-mcp","server"],
      "env": { "ADB_PATH": "/path/to/adb", "XCRUN_PATH": "/usr/bin/xcrun" }
    }
  }
}
```

> Note: Avoid using `jsonc` fences with inline comments in README code blocks to prevent syntax-highlighting issues on some renderers.

## Docs

- Tools: docs/TOOLS.md (full input/response examples)
- Changelog: docs/CHANGELOG.md
- Tests: test/

## License

MIT
