/**
 * capacitor-bridge.mjs
 *
 * Central bridge between the Mycelium web app and native Capacitor APIs.
 *
 * Exports:
 *   isNative          – true when running inside Capacitor (iOS/Android)
 *   haptic(style)     – trigger haptic feedback
 *   setBadge(n)       – set app icon badge count
 *   notifyMessage(payload) – schedule a local notification for a new message
 *   callStarted(opts) – tell native layer a call is ringing
 *   callEnded()       – dismiss native call UI
 *   initNative()      – bootstraps all native integrations (called once on load)
 */

// ─── Guard: only activate when inside Capacitor ──────────────────────────────
const isNative = !!(window.Capacitor?.isNativePlatform?.());
export { isNative };

if (!isNative) {
  // Running in a plain browser — export no-op stubs and bail out
  console.info('[cap-bridge] Not a native platform, all hooks are no-ops.');
}

// ─── Plugin accessor ─────────────────────────────────────────────────────────
// Capacitor injects all registered plugins into window.Capacitor.Plugins at
// runtime. We use that registry directly — no bundler needed.
function getPlugins() {
  if (!isNative) return {};
  const P = window.Capacitor.Plugins;
  return {
    App:                 P.App,
    StatusBar:           P.StatusBar,
    SplashScreen:        P.SplashScreen,
    Haptics:             P.Haptics,
    PushNotifications:   P.PushNotifications,
    LocalNotifications:  P.LocalNotifications,
    Network:             P.Network,
  };
}

// ─── Haptics ──────────────────────────────────────────────────────────────────
/**
 * @param {'light'|'medium'|'heavy'|'selection'} style
 */
export async function haptic(style = 'light') {
  if (!isNative) return;
  const { Haptics } = getPlugins();
  if (!Haptics) return;
  // ImpactStyle enum values used by the Capacitor Haptics plugin
  const impactStyleMap = { light: 'Light', medium: 'Medium', heavy: 'Heavy' };
  try {
    if (style === 'selection') {
      await Haptics.selectionChanged();
    } else {
      await Haptics.impact({ style: impactStyleMap[style] || 'Light' });
    }
  } catch (e) {
    console.warn('[cap-bridge] haptic failed:', e);
  }
}

// Attach haptic feedback to elements with [data-haptic] attribute
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-haptic]');
  if (el) haptic(el.dataset.haptic || 'light');
}, { passive: true, capture: true });

// ─── Badge ────────────────────────────────────────────────────────────────────
/**
 * Set the app icon badge count. Pass 0 to clear.
 * Uses Capacitor's LocalNotifications badge API as a fallback
 * since there's no official badge package.
 */
export async function setBadge(count) {
  if (!isNative) return;
  try {
    if (window.Capacitor?.Plugins?.Badge) {
      await window.Capacitor.Plugins.Badge.set({ count });
    }
  } catch (e) {
    console.warn('[cap-bridge] setBadge failed:', e);
  }
}

// ─── Push Notifications ───────────────────────────────────────────────────────
let _pushToken = null;

async function registerPush() {
  if (!isNative) return;
  const { PushNotifications } = getPlugins();

  // Check / request permission
  let permStatus = await PushNotifications.checkPermissions();
  if (permStatus.receive === 'prompt') {
    permStatus = await PushNotifications.requestPermissions();
  }
  if (permStatus.receive !== 'granted') {
    console.warn('[cap-bridge] Push notifications permission denied.');
    return;
  }

  await PushNotifications.register();

  PushNotifications.addListener('registration', async (token) => {
    _pushToken = token.value;
    console.log('[cap-bridge] Push token:', _pushToken);

    // Send token to backend
    try {
      await fetch('/register_device', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: _pushToken,
          platform: window.Capacitor.getPlatform(),
        }),
      });
    } catch (e) {
      console.error('[cap-bridge] Failed to register device token:', e);
    }
  });

  PushNotifications.addListener('registrationError', (err) => {
    console.error('[cap-bridge] Push registration error:', err);
  });

  // App is in foreground: show as local notification
  PushNotifications.addListener('pushNotificationReceived', async (notification) => {
    console.log('[cap-bridge] Push received (foreground):', notification);
    const payload = notification.data || {};

    if (document.visibilityState === 'hidden' || payload.forceLocal) {
      // Messages get the reply / mark-as-read actions; calls get answer / decline.
      const isCall = payload.type === 'call';
      await scheduleLocalNotification({
        title: notification.title || 'Mycelium',
        body: notification.body || '',
        extra: payload,
        actionTypeId: isCall ? 'CALL_ACTION' : 'MESSAGE_ACTION',
        channelId: isCall ? 'calls' : 'messages',
      });
    }
  });

  // User tapped a notification or used an action button.
  // On iOS, inline reply on a remote push arrives here as actionId 'reply'
  // with the typed text in inputValue (the MESSAGE_ACTION category is
  // registered via registerActionTypes). On Android, replies are handled
  // natively by NotificationReplyReceiver, so this mainly covers taps there.
  PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    console.log('[cap-bridge] Push action performed:', action);
    const data = action.notification?.data || {};

    if (action.actionId === 'reply' && action.inputValue) {
      window.dispatchEvent(new CustomEvent('cap:quickReply', {
        detail: { convId: data.convId, message: action.inputValue },
      }));
    } else if (action.actionId === 'mark_read') {
      window.dispatchEvent(new CustomEvent('cap:markRead', {
        detail: { convId: data.convId },
      }));
    } else {
      handleNotificationNavigation(data);
    }
  });
}

// ─── Local Notifications ──────────────────────────────────────────────────────
let _notifId = 1000;

/**
 * Schedule a local notification for an incoming message.
 * @param {{ title: string, body: string, extra?: object }} opts
 */
export async function notifyMessage(opts = {}) {
  if (!isNative) return;
  if (document.visibilityState === 'visible') return; // App is focused, no notif needed

  await scheduleLocalNotification({
    title: opts.title || 'New message',
    body: opts.body || '',
    extra: opts.extra || {},
  });
}

async function scheduleLocalNotification({
  title, body, extra = {},
  actionTypeId = 'MESSAGE_ACTION',
  channelId = 'messages',
}) {
  const { LocalNotifications } = getPlugins();
  const id = _notifId++;

  await LocalNotifications.schedule({
    notifications: [{
      id,
      title,
      body,
      extra,
      sound: 'notification.wav',
      smallIcon: 'ic_stat_mycelium',
      actionTypeId,
      channelId,
    }],
  });
}

// Register action types once
async function registerNotificationActions() {
  const { LocalNotifications } = getPlugins();

  // Android 8+ requires channels to exist before any notification is scheduled.
  // Create them here so they're always ready, regardless of whether the user
  // has granted permission yet.
  try {
    await LocalNotifications.createChannel({
      id: 'messages',
      name: 'Messages',
      description: 'New message notifications',
      importance: 3, // IMPORTANCE_DEFAULT
      sound: 'notification.wav',
      vibration: true,
      visibility: 1,
    });
    await LocalNotifications.createChannel({
      id: 'calls',
      name: 'Calls',
      description: 'Incoming call notifications',
      importance: 5, // IMPORTANCE_HIGH — needed for heads-up
      sound: 'ringtone.wav',
      vibration: true,
      visibility: 1,
    });
  } catch (e) {
    // createChannel is Android-only; iOS silently rejects, that's fine.
    console.warn('[cap-bridge] createChannel skipped (likely iOS):', e);
  }

  // Android 13+ (TIRAMISU) requires POST_NOTIFICATIONS permission at runtime.
  // Check and request it before calling registerActionTypes so the OS doesn't throw.
  try {
    let permStatus = await LocalNotifications.checkPermissions();
    if (permStatus.display === 'prompt') {
      permStatus = await LocalNotifications.requestPermissions();
    }
    if (permStatus.display !== 'granted') {
      console.warn('[cap-bridge] Local notifications permission not granted.');
      return;
    }
  } catch (e) {
    console.warn('[cap-bridge] Local notifications permission check failed:', e);
  }

  await LocalNotifications.registerActionTypes({
    types: [
      {
        id: 'MESSAGE_ACTION',
        actions: [
          { id: 'reply', title: 'Reply', input: true, inputButtonTitle: 'Send', inputPlaceholder: 'Message…' },
          { id: 'mark_read', title: 'Mark as read' },
        ],
      },
      {
        id: 'CALL_ACTION',
        actions: [
          { id: 'answer', title: 'Answer' },
          { id: 'decline', title: 'Decline', destructive: true },
        ],
      },
    ],
  });

  LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
    const { actionId, notification, inputValue } = event;
    const extra = notification.extra || {};

    if (actionId === 'reply' && inputValue) {
      // Quick reply: send via existing WS infrastructure
      window.dispatchEvent(new CustomEvent('cap:quickReply', {
        detail: { convId: extra.convId, message: inputValue },
      }));
    } else if (actionId === 'mark_read') {
      window.dispatchEvent(new CustomEvent('cap:markRead', {
        detail: { convId: extra.convId },
      }));
    } else if (actionId === 'answer') {
      handleNotificationNavigation(extra);
      window.dispatchEvent(new CustomEvent('cap:answerCall', { detail: extra }));
    } else if (actionId === 'decline') {
      window.dispatchEvent(new CustomEvent('cap:declineCall', { detail: extra }));
    } else {
      handleNotificationNavigation(extra);
    }
  });
}

// ─── Incoming Call Notification ───────────────────────────────────────────────
/**
 * Show a native "incoming call" local notification with Answer/Decline actions.
 * Falls back gracefully on platforms that don't support full-screen intents.
 */
export async function callStarted({ callId, callerName, callType = 'audio' } = {}) {
  if (!isNative) return;
  const { LocalNotifications } = getPlugins();
  const id = 9999; // fixed ID so we can cancel it

  await LocalNotifications.schedule({
    notifications: [{
      id,
      title: `Incoming ${callType === 'video' ? 'video' : 'voice'} call`,
      body: `${callerName} is calling…`,
      extra: { callId, callType, type: 'incoming_call' },
      sound: 'ringtone.wav',
      smallIcon: 'ic_stat_mycelium',
      actionTypeId: 'CALL_ACTION',
      ongoing: true,
      autoCancel: false,
      channelId: 'calls',
    }],
  });
}

/**
 * Dismiss the incoming call notification.
 */
export async function callEnded() {
  if (!isNative) return;
  const { LocalNotifications } = getPlugins();
  await LocalNotifications.cancel({ notifications: [{ id: 9999 }] });
}

// ─── Deep Link / App URL Handling ─────────────────────────────────────────────
async function setupDeepLinks() {
  const { App } = getPlugins();

  App.addListener('appUrlOpen', (data) => {
    console.log('[cap-bridge] Deep link:', data.url);
    const url = new URL(data.url);

    // mycelium://invite/<token>
    if (url.hostname === 'invite' || url.pathname.startsWith('/invite/')) {
      const token = url.pathname.split('/').pop() || url.hostname;
      window.dispatchEvent(new CustomEvent('cap:deepLinkInvite', { detail: { token } }));
    }

    // mycelium://conv/<convId> — tapping a DM/message notification.
    if (url.hostname === 'conv') {
      const convId = url.pathname.split('/').pop() || url.hostname;
      window.dispatchEvent(new CustomEvent('cap:navigateToConv', { detail: { convId } }));
    }

    // mycelium://channel/<serverId>/<channelId>
    if (url.hostname === 'channel') {
      const [, serverId, channelId] = url.pathname.split('/');
      window.dispatchEvent(new CustomEvent('cap:deepLinkChannel', {
        detail: { serverId, channelId },
      }));
    }
  });
}

// ─── Status Bar + Safe Area ───────────────────────────────────────────────────
const SYSTEM_BAR_COLOR = '#1a1a2e';

async function setupStatusBar() {
  const { StatusBar } = getPlugins();
  if (!StatusBar) return;
  const platform = window.Capacitor.getPlatform();

  try {
    // Edge-to-edge: WebView draws behind the status bar and gesture nav bar.
    // The safe-area-inset-* env() values then become non-zero and our CSS/bars use them.
    await StatusBar.setOverlaysWebView({ overlay: true });

    if (platform === 'ios') {
      await StatusBar.setStyle({ style: 'Dark' });
    } else {
      await StatusBar.setBackgroundColor({ color: SYSTEM_BAR_COLOR });
      await StatusBar.setStyle({ style: 'Dark' });
    }
  } catch (e) {
    console.warn('[cap-bridge] StatusBar setup failed:', e);
  }

  injectSafeAreaCSS();
  injectSystemBars();
}

/**
 * Inject two thin fixed overlay bars:
 *   - Top bar  → covers the notch / status bar area
 *   - Bottom bar → covers the Android gesture navigation bar area
 * They sit at z-index 9999 so they're always on top, and are sized via
 * the safe-area-inset env() values so they exactly match the system UI.
 */
function injectSystemBars() {
  if (document.getElementById('cap-system-bars')) return;

  // Safety net: ensure viewport-fit=cover is set so env(safe-area-inset-*)
  // returns real values. Without this the bars would have height 0.
  const vmeta = document.querySelector('meta[name="viewport"]');
  if (vmeta && !vmeta.content.includes('viewport-fit')) {
    vmeta.content += ',viewport-fit=cover';
  }

  const style = document.createElement('style');
  style.id = 'cap-system-bars';
  style.textContent = `
    /* Top bar – covers notch / status bar */
    #cap-top-bar {
      position: fixed;
      top: 0; left: 0; right: 0;
      height: env(safe-area-inset-top, 0px);
      background: ${SYSTEM_BAR_COLOR};
      z-index: 9999;
      pointer-events: none;
    }
    /* Bottom bar – covers Android gesture nav bar */
    #cap-bottom-bar {
      position: fixed;
      bottom: 0; left: 0; right: 0;
      height: env(safe-area-inset-bottom, 0px);
      background: ${SYSTEM_BAR_COLOR};
      z-index: 9999;
      pointer-events: none;
    }
  `;
  document.head.appendChild(style);

  const top = document.createElement('div');
  top.id = 'cap-top-bar';

  const bottom = document.createElement('div');
  bottom.id = 'cap-bottom-bar';

  document.body.prepend(bottom);
  document.body.prepend(top);

  const body = document.querySelector("body")
  body.style.boxSizing = "border-box"
  body.style.paddingTop = `env(safe-area-inset-top, 24px)`
  body.style.paddingBottom = `env(safe-area-inset-bottom, 16px)`


  // JS fallback: env() requires a layout pass to resolve.
  // After paint, check if the computed height is still 0 on Android
  // and force sensible pixel values (status bar ~24dp, gesture bar ~16dp at mdpi).
  if (window.Capacitor?.getPlatform() === 'android') {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const topH = parseFloat(getComputedStyle(top).height);
        const botH = parseFloat(getComputedStyle(bottom).height);
        // If env() didn't resolve, fall back to window.screen density-aware defaults
        const dpr = window.devicePixelRatio || 1;
        if (topH === 0) {
          // ~24dp status bar height
          top.style.height = Math.round(24 * dpr * 0.5) + 'px';
        }
        if (botH === 0) {
          // ~16dp gesture bar height (only when gesture nav is active)
          // We can't detect gesture vs button nav reliably in JS, so we use
          // a small default that looks fine on both
          bottom.style.height = Math.round(16 * dpr * 0.5) + 'px';
        }

        body.style.paddingTop = top.style.height
        body.style.paddingBottom = bottom.style.height
      });
    });
  }
}

function injectSafeAreaCSS() {
  if (document.getElementById('capacitor-safe-area')) return;
  const style = document.createElement('style');
  style.id = 'capacitor-safe-area';
  style.textContent = `
    /* Expose safe area values as CSS custom properties */
    :root {
      --safe-area-inset-top:    env(safe-area-inset-top,    0px);
      --safe-area-inset-right:  env(safe-area-inset-right,  0px);
      --safe-area-inset-bottom: env(safe-area-inset-bottom, 0px);
      --safe-area-inset-left:   env(safe-area-inset-left,   0px);
    }

    /* body uses position:fixed + 100svh, so we offset the main columns instead */
    #main-selector {
      padding-top:  var(--safe-area-inset-top);
      padding-left: var(--safe-area-inset-left);
      padding-bottom: var(--safe-area-inset-bottom);
    }
    #sec-column {
      padding-top: var(--safe-area-inset-top);
      padding-bottom: var(--safe-area-inset-bottom);
    }
    #content {
      padding-top:    var(--safe-area-inset-top);
      padding-right:  var(--safe-area-inset-right);
      padding-bottom: var(--safe-area-inset-bottom);
    }

    /* Menus and modals should also respect the notch */
    .menu-wrapper .menu,
    .fullscreen-menu {
      padding-top:    var(--safe-area-inset-top);
      padding-bottom: var(--safe-area-inset-bottom);
    }

    /* Loading screen */
    #loading-screen {
      padding-top: var(--safe-area-inset-top);
    }
  `;
  document.head.appendChild(style);
}

// ─── Android Back Button ──────────────────────────────────────────────────────
async function setupBackButton() {
  if (window.Capacitor?.getPlatform() !== 'android') return;
  const { App } = getPlugins();

  App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) {
      window.history.back();
    } else {
      // Try closing any open menu/modal first
      const openMenu = document.querySelector('.menu-wrapper[style*="flex"], .fullscreen-menu[style*="flex"]');
      if (openMenu) {
        const closeBtn = openMenu.querySelector('.close, .close-btn');
        if (closeBtn) { closeBtn.click(); return; }
      }
      // Minimize the app (go to background) instead of exiting
      App.minimizeApp();
    }
  });
}

// ─── Network awareness ───────────────────────────────────────────────────────
async function setupNetwork() {
  const { Network } = getPlugins();
  const status = await Network.getStatus();
  window.__networkOnline = status.connected;

  Network.addListener('networkStatusChange', (status) => {
    window.__networkOnline = status.connected;
    window.dispatchEvent(new CustomEvent('cap:networkChange', { detail: status }));

    if (!status.connected) {
      console.warn('[cap-bridge] Network offline');
    } else {
      console.log('[cap-bridge] Network back online, reconnecting WS…');
      // Trigger WS reconnect if needed
      window.dispatchEvent(new Event('online'));
    }
  });
}

// ─── Splash screen hide ───────────────────────────────────────────────────────
export async function hideSplash() {
  if (!isNative) return;
  const { SplashScreen } = getPlugins();
  await SplashScreen.hide({ fadeOutDuration: 500 });
}

// ─── Logout helper ───────────────────────────────────────────────────────────
/**
 * Call this when the user logs out to unregister the push token.
 */
export async function nativeLogout() {
  if (!isNative || !_pushToken) return;
  try {
    await fetch('/unregister_device', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: _pushToken }),
    });
  } catch (e) {
    console.warn('[cap-bridge] unregisterDevice failed:', e);
  }
  _pushToken = null;
}

// Reset badge when the app comes to foreground
if (isNative) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      window.__badgeCount = 0;
      setBadge(0);
    }
  });
}

// ─── Navigation helper ────────────────────────────────────────────────────────
function handleNotificationNavigation(extra = {}) {
  if (extra.convId) {
    window.dispatchEvent(new CustomEvent('cap:navigateToConv', { detail: { convId: extra.convId } }));
  } else if (extra.serverId && extra.channelId) {
    window.dispatchEvent(new CustomEvent('cap:deepLinkChannel', {
      detail: { serverId: extra.serverId, channelId: extra.channelId },
    }));
  }
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────
/**
 * Call once during app init (after DOM is ready).
 * Safe to call on any page — does NOT register push notifications.
 * Push registration requires Firebase to be initialised and the user
 * to be authenticated; call registerPushNotifications() separately
 * from main.mjs after a successful login.
 */
export async function initNative() {
  if (!isNative) return;
  console.log('[cap-bridge] Initialising native integrations…');

  await Promise.all([
    setupStatusBar(),
    setupDeepLinks(),
    setupBackButton(),
    setupNetwork(),
    registerNotificationActions(),
  ]);

  console.log('[cap-bridge] Native integrations ready.');
}

/**
 * Register for push notifications (FCM/APNs).
 * Requires Firebase to be initialised (google-services.json present).
 * Call this ONLY after the user is authenticated (e.g. from main.mjs).
 */
export async function registerPushNotifications() {
  await registerPush();
}

// Auto-bootstrap when the module loads
if (isNative) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNative);
  } else {
    initNative();
  }
}
