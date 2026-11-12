package com.technative.audiobookmanager;

import android.util.Log;

import com.getcapacitor.BridgeActivity;

import java.io.File;

public class MainActivity extends BridgeActivity {
  private static final String TAG = "MainActivity";

  @Override public void onCreate(android.os.Bundle savedInstanceState) {
    // Run before BridgeActivity creates the WebView, so a restored worker
    // cannot intercept the bundled app's first navigation.
    removeStaleServiceWorkerData();
    registerPlugin(BiometricVaultPlugin.class);
    super.onCreate(savedInstanceState);
    // Install after the WebView exists: the default client delegates asset
    // loads and everything else to Capacitor's asset loader. Ours answers
    // /_media itself (native fetch of the configured server) and defers the
    // rest. Without this, the <audio> is fed an absolute http URL, which
    // Chrome blocks as mixed content.
    if (bridge != null) {
      bridge.setWebViewClient(new MediaProxyWebViewClient(bridge));
    }
  }

  private void removeStaleServiceWorkerData() {
    File serviceWorkerData = new File(
        getApplicationInfo().dataDir,
        "app_webview/Default/Service Worker"
    );
    if (serviceWorkerData.exists() && !deleteRecursively(serviceWorkerData)) {
      Log.e(TAG, "Could not remove stale WebView service-worker data at "
          + serviceWorkerData.getAbsolutePath());
    }
  }

  private boolean deleteRecursively(File file) {
    File[] children = file.listFiles();
    if (children != null) {
      for (File child : children) {
        if (!deleteRecursively(child)) return false;
      }
    }
    return file.delete();
  }
}
