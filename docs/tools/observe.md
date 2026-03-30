# Observe (logs, screenshots, UI trees)

Tools that retrieve device state, logs, screenshots and UI hierarchies.

## get_logs

Fetch recent logs as structured entries optimized for AI agents.

Input (example):

```json
{ "platform": "android|ios", "appId": "com.example.app", "deviceId": "emulator-5554", "pid": 1234, "tag": "MyTag", "level": "ERROR", "contains": "timeout", "since_seconds": 60, "limit": 50 }
```

Defaults:

- No filters → return the most recent 50 log entries (app-scoped if appId provided), across all levels.

Response (structured):

```json
{ "device": { "platform": "android", "id": "emulator-5554" }, "logs": [ { "timestamp": "2026-03-30T16:00:00.000Z", "level": "ERROR", "tag": "MyTag", "pid": 1234, "message": "Something failed" } ], "count": 1, "filtered": true }
```

Notes:

- Each log entry: timestamp (ISO), level (VERBOSE|DEBUG|INFO|WARN|ERROR), tag (string), pid (number|null), message (string).
- Logs ordered oldest → newest. count equals number of entries returned. filtered is true if any filter was applied.
- Supported filters: pid, tag, level, contains, since_seconds, limit.
- Platform behaviour: Android uses `adb logcat` with source-side filters where possible; iOS uses unified logging (`log show`/simctl) and maps subsystem/category → tag.
- Errors are returned as structured objects with `error.code` and `error.message`. Possible codes: LOGS_UNAVAILABLE, INVALID_FILTER, PLATFORM_NOT_SUPPORTED, INTERNAL_ERROR.

## capture_screenshot
Capture screen. Returns JSON metadata then an image/png block with base64 PNG data.

Input:

```
{ "platform": "android", "deviceId": "emulator-5554" }
```

Response (metadata):

```json
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

```json
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

```json
{ "device": { "platform": "android", "id": "emulator-5554" }, "package": "com.example.app", "activity": "com.example.app.MainActivity", "shortActivity": "MainActivity" }
```

---

## capture_debug_snapshot
Capture a complete debug snapshot of the app state for diagnostics and post-mortem analysis.

Input:

```json
{
  "reason": "optional string describing why snapshot is taken",
  "includeLogs": true,
  "logLines": 200,
  "platform": "android | ios",
  "appId": "optional package/bundle id to scope logs",
  "deviceId": "optional device serial/udid",
  "sessionId": "optional log stream session id to prefer"
}
```

Behavior:
- Captures screenshot (base64), current activity (Android), screen fingerprint, full UI tree, and recent logs.
- Prefers active log stream entries (read_log_stream) and falls back to get_logs when no active stream is available.
- Returns partial data when components fail and includes per-part error fields (e.g. `screenshot_error`, `ui_tree_error`).
- Caps logs to `logLines` entries and prefers recent entries.
- Fast by default: does not wait for new logs and avoids long blocking operations.

Response (example):

```json
{
  "timestamp": 1710000000,
  "reason": "Crash after tapping checkout",
  "activity": "CheckoutActivity",
  "fingerprint": "abc123",
  "screenshot": "<base64 PNG string>",
  "ui_tree": { ... },
  "logs": [ { "timestamp": 1710000000, "level": "ERROR", "message": "NullPointerException at CheckoutViewModel" } ]
}
```

Notes:
- Useful immediately after detecting crashes or unexpected UI behaviour.
- Do not expect perfect data during a crash; tool is designed to return best-effort context and include errors for failed parts.

---

## get_screen_fingerprint
Generate a stable fingerprint representing the visible screen. Useful for detecting navigation changes, preventing loops, and synchronisation.

Input (optional):

```
{ "platform": "android", "deviceId": "emulator-5554" }
```

Response:

```json
{ "fingerprint": "<sha256_hex>", "activity": "com.example.app.MainActivity" }
```

Notes:
- Uses get_ui_tree and (on Android) get_current_screen as inputs.
- Normalises visible, interactable or structurally significant elements (class/type, resourceId, text, contentDesc).
- Trims and lowercases text, filters out likely dynamic values (timestamps, counters).
- Sorts deterministically (top-to-bottom, left-to-right) and limits elements to 50.
- Returns fingerprint: null and an error message if the UI tree or activity cannot be retrieved.

---

## start_log_stream / read_log_stream / stop_log_stream
Start a background adb logcat stream and retrieve parsed NDJSON entries.

read_log_stream response example:

```json
{ "entries": [ { "timestamp": "2026-03-20T...Z", "level": "E", "tag": "AppTag", "message": "FATAL EXCEPTION" } ], "crash_summary": { "crash_detected": true } }
```
