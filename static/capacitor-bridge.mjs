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
    // Try native badge via setApplicationIconBadgeNumber (iOS) / shortcut badge (Android)
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
      await fetch('/registerDevice', {
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
      await scheduleLocalNotification({
        title: notification.title || 'Mycelium',
        body: notification.body || '',
        extra: payload,
      });
    }
  });

  // User tapped a notification
  PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    console.log('[cap-bridge] Push action performed:', action);
    handleNotificationNavigation(action.notification?.data || {});
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

async function scheduleLocalNotification({ title, body, extra = {} }) {
  const { LocalNotifications } = getPlugins();
  const id = _notifId++;

  await LocalNotifications.schedule({
    notifications: [{
      id,
      title,
      body,
      extra,
      sound: 'notification.wav',
      smallIcon: 'ic_stat_icon_config_sample',
      actionTypeId: 'MESSAGE_ACTION',
      channelId: 'messages',
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
          { id: 'answer', title: '✅ Answer' },
          { id: 'decline', title: '❌ Decline', destructive: true },
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
      smallIcon: 'ic_stat_icon_config_sample',
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
async function setupStatusBar() {
  const { StatusBar } = getPlugins();
  if (!StatusBar) return;
  const platform = window.Capacitor.getPlatform();

  try {
    if (platform === 'ios') {
      // 'Dark' style = light icons on dark background
      await StatusBar.setStyle({ style: 'Dark' });
    } else {
      await StatusBar.setBackgroundColor({ color: '#1a1a2e' });
      await StatusBar.setStyle({ style: 'Dark' });
    }
  } catch (e) {
    console.warn('[cap-bridge] StatusBar setup failed:', e);
  }

  // Inject CSS custom properties for safe area so existing CSS can use them
  injectSafeAreaCSS();
}

function injectSafeAreaCSS() {
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
    await fetch('/unregisterDevice', {
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
