package com.technative.audiobookmanager;

import android.content.Intent;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.List;

/**
 * Launches external store apps (spec 39 / ADR 034).
 *
 * Kept deliberately small: every branch is reviewed line by line, and the JS
 * bridge ({@code client/src/lib/externalIntent.ts}) carries contract tests for
 * everything observable from the WebView.
 *
 * <p>canResolve: reports whether this intent resolves to a non-browser app on
 * this device — drives "opens in X" vs "get X on Google Play" UI.</p>
 *
 * <p>launchIntent: ACTION_VIEW + BROWSABLE, optional setPackage, optional
 * FLAG_ACTIVITY_REQUIRE_NON_BROWSER (ignored on API &lt; 33). Failure NEVER
 * throws; it resolves {@code completed:false} and the JS caller degrades to a
 * Custom Tab.</p>
 *
 * <p>No logging of URLs, ever — log lines here would leak reading intent.</p>
 */
@CapacitorPlugin(name = "ExternalIntent")
public class ExternalIntentPlugin extends Plugin {
  private static final String TAG = "ExternalIntent";

  private static Intent buildIntent(Uri uri, String packageName, boolean requireApp) {
    Intent intent = new Intent(Intent.ACTION_VIEW, uri);
    intent.addCategory(Intent.CATEGORY_BROWSABLE);
    if (packageName != null && !packageName.isEmpty()) {
      intent.setPackage(packageName);
    }
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    // REQUIRE_NON_BROWSER exists from API 33; unknown flag bits are not
    // something to gamble with on older devices.
    if (requireApp && android.os.Build.VERSION.SDK_INT >= 33) {
      intent.addFlags(Intent.FLAG_ACTIVITY_REQUIRE_NON_BROWSER);
    }
    return intent;
  }

  private boolean resolvable(Intent intent) {
    try {
      // Flags 0 on purpose: some store apps declare only BROWSABLE, never
      // DEFAULT, so a MATCH_DEFAULT_ONLY query would miss them. The launch
      // path catches failures separately; this only drives UI copy.
      List<ResolveInfo> activities =
          getContext().getPackageManager().queryIntentActivities(intent, 0);
      return !activities.isEmpty();
    } catch (Exception e) {
      return false;
    }
  }

  @PluginMethod
  public void canResolve(PluginCall call) {
    String url = call.getString("url");
    if (url == null) {
      call.reject("url required", "BAD_INPUT");
      return;
    }
    Intent intent = buildIntent(Uri.parse(url), call.getString("package"), false);
    JSObject response = new JSObject();
    response.put("value", resolvable(intent));
    call.resolve(response);
  }

  @PluginMethod
  public void launchIntent(PluginCall call) {
    String url = call.getString("url");
    if (url == null) {
      call.reject("url required", "BAD_INPUT");
      return;
    }
    Boolean requireApp = call.getBoolean("requireApp", Boolean.FALSE);
    Intent intent = buildIntent(
        Uri.parse(url), call.getString("package"), Boolean.TRUE.equals(requireApp));
    try {
      if (call.getString("chooserTitle") != null) {
        Intent chooser = Intent.createChooser(intent, call.getString("chooserTitle"));
        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(chooser);
      } else {
        getContext().startActivity(intent);
      }
      JSObject response = new JSObject();
      response.put("completed", true);
      call.resolve(response);
    } catch (android.content.ActivityNotFoundException e) {
      JSObject response = new JSObject();
      response.put("completed", false);
      call.resolve(response);
    } catch (Exception e) {
      Log.w(TAG, "launch failed");
      JSObject response = new JSObject();
      response.put("completed", false);
      call.resolve(response);
    }
  }
}
