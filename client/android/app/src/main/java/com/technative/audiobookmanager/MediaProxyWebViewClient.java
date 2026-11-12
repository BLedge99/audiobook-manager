package com.technative.audiobookmanager;

import android.util.Log;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Fulfils the app's media requests from the WebView's own origin.
 *
 * <p>The WebView serves the bundled app from {@code https://localhost}, a
 * secure context. Chrome auto-upgrades http media URLs to https, which the
 * plain-HTTP household server cannot answer, so an absolute LAN URL on the
 * {@code <audio>} element fails outright. Instead the shell rewrites media
 * URLs to {@code https://localhost/_media?url=…} (see
 * {@code client/src/lib/mediaProxy.ts}); this interceptor answers them: it
 * fetches the real URL with a native HTTP client and hands the bytes back as
 * a {@link WebResourceResponse}. 206/416 Range semantics pass through, which
 * is what seek support requires.
 *
 * <p>Only the media surface is relayed (see {@link MediaProxy}); everything
 * else delegates to the asset loader. Credentials never cross: the media
 * token rides in the inner URL, and no other header is forwarded. The query
 * string is never logged — it can carry a media token.
 */
public class MediaProxyWebViewClient extends BridgeWebViewClient {
    private static final String TAG = "MediaProxy";
    private static final int CONNECT_TIMEOUT_MS = 10_000;
    private static final int READ_TIMEOUT_MS = 60_000;

    public MediaProxyWebViewClient(Bridge bridge) {
        super(bridge);
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        String url = request.getUrl() == null ? null : request.getUrl().toString();
        if (url == null) return super.shouldInterceptRequest(view, request);

        String inner = MediaProxy.innerUrl(url);
        if (inner == null) {
            // A /_media URL that fails validation is a 400, never a fall-through
            // to the network or the asset loader.
            return MediaProxy.isProxyShaped(url) ? simpleResponse(400) : super.shouldInterceptRequest(view, request);
        }

        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(inner).openConnection();
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setRequestMethod(request.getMethod() == null ? "GET" : request.getMethod());
            connection.setInstanceFollowRedirects(false);
            connection.setUseCaches(false);
            for (Map.Entry<String, String> entry
                : MediaProxy.forwardedRequestHeaders(request.getRequestHeaders()).entrySet()) {
                connection.setRequestProperty(entry.getKey(), entry.getValue());
            }

            int status = connection.getResponseCode();
            Map<String, String> flat = flatten(connection.getHeaderFields());
            String mime = MediaProxy.contentType(flat);
            Map<String, String> responseHeaders = MediaProxy.responseHeaders(flat);
            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            if (stream == null) stream = new ByteArrayInputStream(new byte[0]);
            return new WebResourceResponse(
                mime, null, status, MediaProxy.reasonPhrase(status), responseHeaders, stream);
        } catch (Exception error) {
            logFailure(inner, error);
            return simpleResponse(502);
        }
    }

    private static Map<String, String> flatten(Map<String, List<String>> headerFields) {
        Map<String, String> flat = new HashMap<>();
        if (headerFields == null) return flat;
        for (Map.Entry<String, List<String>> entry : headerFields.entrySet()) {
            if (entry.getKey() == null) continue;
            List<String> values = entry.getValue();
            if (values != null && !values.isEmpty()) flat.put(entry.getKey(), values.get(0));
        }
        return flat;
    }

    private static void logFailure(String inner, Exception error) {
        String path = "?";
        try {
            path = new URI(inner).getPath(); // never log the query: it may carry a media token
        } catch (Exception ignored) {
            // leave the placeholder
        }
        Log.w(TAG, "proxy fetch failed for path " + path + " (" + error.getClass().getSimpleName() + ")");
    }

    private static WebResourceResponse simpleResponse(int status) {
        String reason = MediaProxy.reasonPhrase(status);
        byte[] body = (status == 400
            ? "Bad Request" : "Upstream fetch failed").getBytes(StandardCharsets.UTF_8);
        return new WebResourceResponse(
            "text/plain", "UTF-8", status, reason,
            Collections.singletonMap("Cache-Control", "no-store"),
            new ByteArrayInputStream(body));
    }
}
