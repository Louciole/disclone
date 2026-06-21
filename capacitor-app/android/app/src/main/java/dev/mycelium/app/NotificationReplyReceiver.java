package dev.carbonlab.mycelium.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

import androidx.core.app.RemoteInput;

import java.util.HashMap;
import java.util.Map;

/**
 * Handles the inline "Reply" RemoteInput from a message notification: appends
 * the reply to the conversation thread immediately, then sends it to the
 * backend. Uses goAsync() so the process stays alive until the network call
 * finishes, and surfaces a clear failure state if the send doesn't succeed.
 */
public class NotificationReplyReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        Bundle results = RemoteInput.getResultsFromIntent(intent);
        if (results == null) {
            return;
        }
        CharSequence reply = results.getCharSequence(MyceliumMessagingService.REPLY_KEY);
        final String convId = intent.getStringExtra(MyceliumMessagingService.EXTRA_CONV_ID);
        final int notifId = intent.getIntExtra(MyceliumMessagingService.EXTRA_NOTIF_ID, -1);

        if (reply == null || reply.toString().trim().isEmpty() || convId == null) {
            return;
        }

        final String text = reply.toString();
        final Context appCtx = context.getApplicationContext();

        final Map<String, String> data = new HashMap<>();
        data.put("type", "message");
        data.put("convId", convId);

        // Show the user's reply in the thread right away (optimistic UI).
        NotificationHelper.appendOwnReply(appCtx, data, notifId, text);

        // Keep the receiver (and process) alive until the send completes.
        final PendingResult pending = goAsync();
        ReplySender.sendMessage(convId, text, success -> {
            if (!success) {
                NotificationHelper.markReplyFailed(appCtx, data, notifId, text);
            }
            pending.finish();
        });
    }
}
