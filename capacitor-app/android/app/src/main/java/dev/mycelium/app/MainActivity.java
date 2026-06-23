package dev.carbonlab.mycelium.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DownloadPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
