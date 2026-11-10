package com.technative.audiobookmanager;

import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.net.URI;

@CapacitorPlugin(name = "NativeMediaProxy")
public class NativeMediaProxyPlugin extends Plugin {
  static final String PREFERENCES = "native_media_proxy";
  static final String SERVER_URL_KEY = "server_url";

  @PluginMethod
  public void setServerUrl(PluginCall call) {
    String serverUrl = call.getString("serverUrl");
    if (!isValidServerUrl(serverUrl)) {
      call.reject("A valid HTTP or HTTPS server URL is required.");
      return;
    }

    SharedPreferences preferences = getContext().getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    preferences.edit().putString(SERVER_URL_KEY, serverUrl).apply();
    call.resolve();
  }

  private boolean isValidServerUrl(String value) {
    if (value == null || value.length() > 2048) return false;
    try {
      URI uri = URI.create(value);
      String scheme = uri.getScheme();
      String path = uri.getPath();
      return ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme))
          && uri.getHost() != null
          && uri.getRawUserInfo() == null
          && uri.getRawQuery() == null
          && uri.getRawFragment() == null
          && path != null
          && !path.contains("..")
          && (uri.normalize().getPath() == null || path.equals(uri.normalize().getPath()));
    } catch (IllegalArgumentException error) {
      return false;
    }
  }
}
