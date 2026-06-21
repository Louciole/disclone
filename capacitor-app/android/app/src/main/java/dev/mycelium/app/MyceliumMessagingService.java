package dev.carbonlab.mycelium.app;

import android.app.ActivityManager;
import android.content.Context;

import androidx.annotation.NonNull;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.List;
import java.util.Map;

/**
 * Custom FCM handler. We send DATA-ONLY messages from the server (see
 * server.py -> sendPushNotification), so onMessageReceived() fires in ALL
 * app states (foreground, background, killed) — unlike a "notification"
 * payload, which the OS renders itself and which therefore cannot carry our
 * inline reply action.
 *
 * This service builds the notification itself so it can attach a RemoteInput
 * "Reply" action for direct messages. The reply is delivered to
 * NotificationReplyReceiver, which posts it to the backend.
 *
 * NOTE: declared in AndroidManifest.xml BEFORE the Capacitor push plugin's
 * service so FCM dispatches messages here. The plugin is still used for
 * permission prompts and the initial token (FirebaseMessaging.getToken()).
 */
public class MyceliumMessagingService extends FirebaseMessagingService {

    public static final String REPLY_KEY = "key_text_reply";
    public static final String EXTRA_CONV_ID = "convId";
    public static final String EXTRA_NOTIF_ID = "notifId";
    public static final String ACTION_REPLY = "dev.carbonlab.mycelium.app.ACTION_REPLY";

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        Map<String, String> data = remoteMessage.getData();
        if (data == null || data.isEmpty()) {
            return;
        }

        // When the app is open, the live WebSocket already delivers the message
        // in-app, so don't also post a system notification (matches the previous
        // foreground behavior and avoids notifying the user about the chat they're
        // actively looking at).
        if (isAppInForeground()) {
            return;
        }

        NotificationHelper.showIncoming(getApplicationContext(), data);
    }

    @Override
    public void onNewToken(@NonNull String token) {
        // Initial registration happens via the Capacitor plugin's getToken() flow;
        // this handles refreshes (best-effort, using the WebView auth cookie).
        ReplySender.registerToken(token);
    }

    private boolean isAppInForeground() {
        ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
        if (am == null) {
            return false;
        }
        List<ActivityManager.RunningAppProcessInfo> procs = am.getRunningAppProcesses();
        if (procs == null) {
            return false;
        }
        String pkg = getPackageName();
        for (ActivityManager.RunningAppProcessInfo p : procs) {
            if (p.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
                    && pkg.equals(p.processName)) {
                return true;
            }
        }
        return false;
    }
}
