# Observe (logs, screenshots, UI trees)

Tools that retrieve device state, logs, screenshots and UI hierarchies.

## get_logs
Fetch recent logs from the app or device.

Input:

```json
{ "platform": "android", "appId": "com.example.app", "deviceId": "emulator-5554", "lines": 200 }
```

Response (metadata):

```json
{ "entries": 200, "crash_summary": { "crash_detected": false } }
```

Followed by a raw log plain text block.

Notes:
- Android log parsing includes basic crash detection (searching for "FATAL EXCEPTION" and exception names).
- Use `lines` to control how many log lines are returned from `adb logcat`.

---

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

## start_log_stream / read_log_stream / stop_log_stream
Start a background adb logcat stream and retrieve parsed NDJSON entries.

read_log_stream response example:

```json
{ "entries": [ { "timestamp": "2026-03-20T...Z", "level": "E", "tag": "AppTag", "message": "FATAL EXCEPTION" } ], "crash_summary": { "crash_detected": true } }
```
