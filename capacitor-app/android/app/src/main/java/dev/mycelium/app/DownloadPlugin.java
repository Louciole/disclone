package dev.carbonlab.mycelium.app;

import android.app.DownloadManager;
import android.content.Context;
import android.net.Uri;
import android.os.Environment;
import android.webkit.CookieManager;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Download")
public class DownloadPlugin extends Plugin {

    @PluginMethod
    public void downloadFile(PluginCall call) {
        String url = call.getString("url");
        String filename = call.getString("filename", "download");

        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }

        // Read cookies straight from the WebView's store — this includes HttpOnly
        // session cookies that are invisible to document.cookie in JS.
        String cookies = CookieManager.getInstance().getCookie(url);

        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
        request.setTitle(filename);
        request.setDescription("Mycelium");
        request.setNotificationVisibility(
            DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED
        );
        request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename);
        request.setAllowedOverMetered(true);
        request.setAllowedOverRoaming(true);
        if (cookies != null && !cookies.isEmpty()) {
            request.addRequestHeader("Cookie", cookies);
        }

        DownloadManager dm =
            (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        dm.enqueue(request);
        call.resolve();
    }
}
