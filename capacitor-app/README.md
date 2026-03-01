# Mycelium — Capacitor Mobile App

Wraps the existing Mycelium web frontend into a native iOS / Android app using **Capacitor 8**.

---

## Features

| Feature | Implementation |
|---|---|
| Push notifications | `@capacitor/push-notifications` + FCM/APNs |
| Local notifications (messages) | `@capacitor/local-notifications` with Reply / Mark-read actions |
| Incoming call notification | `@capacitor/local-notifications` with Answer / Decline actions |
| Haptic feedback | `@capacitor/haptics` via `[data-haptic]` attribute |
| Status bar theming | `@capacitor/status-bar` |
| Splash screen | `@capacitor/splash-screen` (auto-hidden after app ready) |
| Deep links | `mycelium://invite/<token>`, `mycelium://channel/<srv>/<ch>` |
| Android back button | Closes modals → minimises app |
| Network awareness | `@capacitor/network` → auto WS reconnect |
| Safe area insets | `env(safe-area-inset-*)` CSS variables injected automatically |
| Badge count | Via `window.Capacitor.Plugins.Badge` (if plugin present) |

---

## Prerequisites

- Node.js 18+
- **iOS**: macOS + Xcode 15+ + CocoaPods
- **Android**: Android Studio Hedgehog+ + JDK 17+
- A running Mycelium backend (`server.py`)

---

## Quick Start

### 1. Install dependencies (already done if you cloned this repo)

```bash
cd capacitor-app
npm install
```

### 2. Scaffold native projects

```bash
npm run add:ios      # npx cap add ios
npm run add:android  # npx cap add android
```

### 3. Apply native configuration

**Android** — open `android-manifest-additions.txt` and merge the snippets into  
`android/app/src/main/AndroidManifest.xml`.

**iOS** — open `ios-info-plist-additions.txt` and add the keys to  
`ios/App/App/Info.plist`, then enable capabilities in Xcode (see file for details).

### 4. Generate app icons + splash screens

Place your assets in `resources/`:

```
resources/
  icon.png          1024×1024  (no transparency)
  splash.png        2732×2732
  splash-dark.png   2732×2732  (optional)
```

Then run:

```bash
npx @capacitor/assets generate
```

### 5. Build & sync

```bash
npm run build          # patches main.html + runs cap sync
# or for live-reload dev:
DEV_SERVER_URL=http://192.168.1.x:8080 npm run dev
```

### 6. Open in IDE

```bash
npm run open:ios      # opens Xcode
npm run open:android  # opens Android Studio
```

---

## Push Notifications Backend Setup

The app sends the FCM/APNs device token to `POST /registerDevice` on first launch.  
The backend stores it in the `device_token` table (added to `db/schema.sql`).

To actually **send** pushes from the server when a message arrives:

1. Create a Firebase project → get `serviceAccountKey.json`
2. Install `firebase-admin`: `pip install firebase-admin`
3. Call `messaging.send()` in `server.py` whenever a WS `notif` of type `message`
   is dispatched to offline users.

Example snippet (add to `server.py`):

```python
import firebase_admin
from firebase_admin import credentials, messaging

cred = credentials.Certificate("serviceAccountKey.json")
firebase_admin.initialize_app(cred)

def send_push(token, title, body, data=None):
    msg = messaging.Message(
        notification=messaging.Notification(title=title, body=body),
        data=data or {},
        token=token,
    )
    messaging.send(msg)
```

---

## Deep Link URL Scheme

| URL | Action |
|---|---|
| `mycelium://invite/<token>` | Opens invitation join page |
| `mycelium://channel/<serverId>/<channelId>` | Navigates to a channel |

---

## Development Tips

- Set `webContentsDebuggingEnabled: true` in `capacitor.config.ts` for Android debugging via Chrome DevTools.
- For iOS live-reload, uncomment the `server.url` block in `capacitor.config.ts` and point it to your dev machine.
- Add `data-haptic="light|medium|heavy|selection"` to any element to get haptic feedback on tap.

---

## File Map

```
capacitor-app/
  capacitor.config.ts          — Capacitor config (plugins, app ID, etc.)
  scripts/build.js             — Pre-sync build script
  resources/                   — App icon + splash source images
  android-manifest-additions.txt
  ios-info-plist-additions.txt

static/
  capacitor-bridge.mjs         — Central native integration bridge (NEW)
  main.html                    — Patched: capacitor.js + bridge import added
  main.mjs                     — Patched: hideSplash + deep-link event handlers
  webrtc.mjs                   — Patched: nativeCallEnded on joinCall/cleanup
  ws/onMessage.mjs             — Patched: native notifications for messages + calls

db/
  schema.sql                   — Patched: device_token table added

server.py                      — Patched: /registerDevice + /unregisterDevice
```

