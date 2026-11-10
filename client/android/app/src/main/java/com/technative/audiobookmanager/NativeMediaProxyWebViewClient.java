package com.technative.audiobookmanager;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.util.Log;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Pattern;

final class NativeMediaProxyWebViewClient extends BridgeWebViewClient {
  private static final String TAG = "NativeMediaProxy";
  private static final String PROXY_PATH = "/__media_proxy";
  private static final Pattern STREAM_PATH =
      Pattern.compile("/api/(?:audiobooks|tracks)/[1-9][0-9]*/stream");
  private static final Pattern TOKEN_QUERY =
      Pattern.compile("media=[A-Za-z0-9._~-]{1,2048}");
  private final Context context;

  NativeMediaProxyWebViewClient(Bridge bridge, Context context) {
    super(bridge);
    this.context = context.getApplicationContext();
  }

  @Override
  public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
    Uri requestUri = request.getUrl();
    if (!isProxyRequest(requestUri)) {
      return super.shouldInterceptRequest(view, request);
    }

    if (!"GET".equalsIgnoreCase(request.getMethod())) {
      return errorResponse(405, "Method Not Allowed");
    }

    String targetUrl = requestUri.getQueryParameter("target");
    if (!isAllowedTarget(targetUrl)) {
      return errorResponse(403, "Invalid media target");
    }

    return forwardRequest(targetUrl, request);
  }

  private boolean isProxyRequest(Uri uri) {
    return "https".equalsIgnoreCase(uri.getScheme())
        && "localhost".equalsIgnoreCase(uri.getHost())
        && PROXY_PATH.equals(uri.getPath());
  }

  private boolean isAllowedTarget(String targetUrl) {
    if (targetUrl == null || targetUrl.length() > 8192) return false;
    String configuredServerUrl = context
        .getSharedPreferences(NativeMediaProxyPlugin.PREFERENCES, Context.MODE_PRIVATE)
        .getString(NativeMediaProxyPlugin.SERVER_URL_KEY, null);
    if (configuredServerUrl == null) return false;

    try {
      URI server = URI.create(configuredServerUrl);
      URI target = URI.create(targetUrl);
      if (!sameOrigin(server, target)
          || target.getRawUserInfo() != null
          || target.getRawFragment() != null) {
        return false;
      }

      String basePath = server.getPath() == null ? "" : server.getPath().replaceAll("/+$", "");
      String targetPath = target.getPath();
      if (targetPath == null || !targetPath.startsWith(basePath)) return false;
      String route = targetPath.substring(basePath.length());
      if (!STREAM_PATH.matcher(route).matches()) return false;

      String query = target.getRawQuery();
      return query == null || TOKEN_QUERY.matcher(query).matches();
    } catch (IllegalArgumentException error) {
      return false;
    }
  }

  private boolean sameOrigin(URI first, URI second) {
    String firstScheme = first.getScheme();
    String secondScheme = second.getScheme();
    if (firstScheme == null || secondScheme == null
        || !firstScheme.equalsIgnoreCase(secondScheme)
        || first.getHost() == null
        || second.getHost() == null
        || !first.getHost().equalsIgnoreCase(second.getHost())) {
      return false;
    }

    return effectivePort(first) == effectivePort(second);
  }

  private int effectivePort(URI uri) {
    if (uri.getPort() >= 0) return uri.getPort();
    return "https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80;
  }

  private WebResourceResponse forwardRequest(String targetUrl, WebResourceRequest request) {
    HttpURLConnection connection = null;
    try {
      connection = (HttpURLConnection) new URL(targetUrl).openConnection();
      connection.setRequestMethod("GET");
      connection.setConnectTimeout(15000);
      connection.setReadTimeout(30000);
      connection.setInstanceFollowRedirects(false);
      connection.setRequestProperty("Accept-Encoding", "identity");

      copyRequestHeader(request, connection, "Range");
      copyRequestHeader(request, connection, "If-Range");

      int status = connection.getResponseCode();
      InputStream responseStream = status >= 400
          ? connection.getErrorStream()
          : connection.getInputStream();
      if (responseStream == null) responseStream = new ByteArrayInputStream(new byte[0]);

      Map<String, String> responseHeaders = new HashMap<>();
      copyResponseHeader(connection, responseHeaders, "Accept-Ranges");
      copyResponseHeader(connection, responseHeaders, "Content-Length");
      copyResponseHeader(connection, responseHeaders, "Content-Range");
      copyResponseHeader(connection, responseHeaders, "Cache-Control");
      copyResponseHeader(connection, responseHeaders, "ETag");
      copyResponseHeader(connection, responseHeaders, "Last-Modified");

      String contentType = connection.getContentType();
      String mimeType = contentType == null ? "application/octet-stream" : contentType.split(";", 2)[0];
      InputStream managedStream = disconnectOnClose(responseStream, connection);
      String reason = connection.getResponseMessage();
      if (reason == null || reason.isEmpty()) reason = "OK";
      return new WebResourceResponse(
          mimeType,
          null,
          status,
          reason,
          responseHeaders,
          managedStream
      );
    } catch (IOException error) {
      if (connection != null) connection.disconnect();
      Log.e(TAG, "Failed to fetch the configured server media stream.", error);
      return errorResponse(502, "Media stream unavailable");
    }
  }

  private void copyRequestHeader(
      WebResourceRequest request,
      HttpURLConnection connection,
      String requestedName
  ) {
    for (Map.Entry<String, String> header : request.getRequestHeaders().entrySet()) {
      if (requestedName.equalsIgnoreCase(header.getKey())) {
        connection.setRequestProperty(requestedName, header.getValue());
        return;
      }
    }
  }

  private void copyResponseHeader(
      HttpURLConnection connection,
      Map<String, String> headers,
      String name
  ) {
    String value = connection.getHeaderField(name);
    if (value != null) headers.put(name, value);
  }

  private InputStream disconnectOnClose(InputStream stream, HttpURLConnection connection) {
    return new FilterInputStream(stream) {
      @Override
      public void close() throws IOException {
        try {
          super.close();
        } finally {
          connection.disconnect();
        }
      }
    };
  }

  private WebResourceResponse errorResponse(int status, String message) {
    Map<String, String> headers = new HashMap<>();
    headers.put("Cache-Control", "no-store");
    return new WebResourceResponse(
        "text/plain",
        "UTF-8",
        status,
        status == 405 ? "Method Not Allowed" : status == 403 ? "Forbidden" : "Bad Gateway",
        headers,
        new ByteArrayInputStream(message.getBytes(java.nio.charset.StandardCharsets.UTF_8))
    );
  }
}
