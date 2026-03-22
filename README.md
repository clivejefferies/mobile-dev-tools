# Mobile Debug Tools

A minimal, secure MCP server for AI-assisted mobile development. Build, install, and inspect Android/iOS apps from an MCP-compatible client.

> **Note:** iOS support is limited currently, Please use with caution and report any issues.

## Requirements

- Node.js >= 18
- [Android SDK](https://developer.android.com/studio) (adb) for Android support
- Xcode command-line tools for iOS support
- [idb](https://github.com/facebook/idb) for iOS device support

## Configuration example

```json
{
  "mcpServers": {
    "mobile-debug": {
      "command": "npx",
      "args": ["--yes","mobile-debug-mcp","server"],
      "env": { "ADB_PATH": "/path/to/adb", "XCRUN_PATH": "/usr/bin/xcrun", "IDB_PATH": "/path/to/idb" }
    }
  }
}
```
## Usage

Example: 
After a crash tell the agent the following:

I have a crash on the app, can you diagnose it, fix and validate using the mcp tools available

## Docs

- Tools: [Tools](docs/TOOLS.md) — full input/response examples
- Changelog: [Changelog](docs/CHANGELOG.md)

## License

MIT

