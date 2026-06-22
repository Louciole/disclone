package dev.carbonlab.mycelium.app;

import android.util.Log;
import android.webkit.CookieManager;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/**
 * Tiny HTTP helper for actions that run outside the WebView (notification
 * reply, token refresh). It reuses the session cookie the WebView already holds
 * for the Mycelium origin, so requests are authenticated exactly like the
 * in-app fetches.
 */
final class ReplySender {

    private static final String BASE = "https://mycelium.carbonlab.dev";
    private static final String TAG = "MyceliumFCM";

    interface Callback {
        void onResult(boolean success);
    }

    private ReplySender() {
    }

    /** Send a chat message to a conversation, mirroring the JS quick-reply call. */
    static void sendMessage(final String convId, final String content, final Callback callback) {
        new Thread(() -> {
            boolean ok = false;
            HttpURLConnection conn = null;
            try {
                String cookie = CookieManager.getInstance().getCookie(BASE);
                if (cookie == null) {
                    Log.w(TAG, "No session cookie for " + BASE + " — reply can't be authenticated");
                } else {
                    // Matches main.mjs: send_message?conv={"id":<id>}&content=<text>&reply=
                    String convParam = URLEncoder.encode("{\"id\":" + convId + "}", "UTF-8");
                    String contentParam = URLEncoder.encode(content, "UTF-8");
                    URL url = new URL(BASE + "/send_message?conv=" + convParam
                            + "&content=" + contentParam + "&reply=");

                    conn = (HttpURLConnection) url.openConnection();
                    conn.setRequestMethod("GET");
                    conn.setRequestProperty("Cookie", cookie);
                    conn.setConnectTimeout(15000);
                    conn.setReadTimeout(15000);
                    int code = conn.getResponseCode();
                    ok = code >= 200 && code < 300;
                    Log.d(TAG, "Reply send HTTP " + code + " (ok=" + ok + ")");
                }
            } catch (Exception e) {
                Log.w(TAG, "Reply send failed", e);
            } finally {
                if (conn != null) {
                    conn.disconnect();
                }
            }
            if (callback != null) {
                callback.onResult(ok);
            }
        }).start();
    }

    /** Forward a refreshed FCM token to the backend (best-effort). */
    static void registerToken(final String token) {
        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                String cookie = CookieManager.getInstance().getCookie(BASE);
                if (cookie == null) {
                    return; // plugin re-registers on next app open
                }
                URL url = new URL(BASE + "/register_device");
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setRequestProperty("Cookie", cookie);
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(15000);
                conn.setDoOutput(true);
                String payload = "{\"token\":\"" + token + "\",\"platform\":\"android\"}";
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(payload.getBytes(StandardCharsets.UTF_8));
                }
                conn.getResponseCode();
            } catch (Exception ignored) {
            } finally {
                if (conn != null) {
                    conn.disconnect();
                }
            }
        }).start();
    }
}
