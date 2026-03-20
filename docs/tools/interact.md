# Interact (UI actions)

Tools that perform UI interactions: tap, swipe, type_text, press_back, and waiting for elements.

## wait_for_element
Wait until a UI element with matching text appears on screen or timeout is reached.

Input:

```
{ "platform": "android", "text": "Home", "timeout": 5000, "deviceId": "emulator-5554" }
```

Response:

```
{ "device": { "platform": "android", "id": "emulator-5554" }, "found": true, "element": { "text": "Home", "resourceId": "com.example:id/home" } }
```

Notes:
- Polls get_ui_tree until timeout or element found. Returns an `error` field if system failures occur.

---

## tap / swipe / type_text / press_back

Tap input example:

```
{ "platform": "android", "deviceId": "emulator-5554", "x": 100, "y": 200 }
```

Response:

```
{ "device": { "platform": "android", "id": "emulator-5554" }, "success": true }
```

Notes:
- tap: `adb shell input tap x y` (Android) or `idb` events for iOS.
- swipe: `adb shell input swipe x1 y1 x2 y2 duration`.
- type_text: `adb shell input text` (spaces encoded as %s) — may fail for special characters.
- press_back: `adb shell input keyevent 4`.
