package com.technative.audiobookmanager;

import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Pure logic behind the `https://localhost/_media?url=…` media proxy.
 *
 * The WebView serves the app from a secure origin, so Chrome blocks an
 * absolute plain-HTTP media URL as mixed content. Instead the media element
 * only ever sees the app origin, and `MediaProxyWebViewClient` fulfils the
 * request natively — over plain HTTP if the household server is plain HTTP.
 *
 * This class is deliberately free of Android types so the security-relevant
 * rules (which targets the proxy may relay, which headers cross) are plain
 * JUnit-testable. `MediaProxyWebViewClient` owns the HTTP plumbing.
 *
 * The allowlist mirrors exactly the media surface the app calls:
 * book stream, book cover, track stream. Nothing else on the LAN is relayable
 * through this proxy. Keep in sync with `server/src/routes/media.ts` and with
 * `client/src/lib/mediaProxy.ts` / `mediaProxy.test.ts`.
 */
public final class MediaProxy {
    public static final String PROXY_HOST = "localhost";
    public static final String PROXY_PATH = "/_media";

    /** Absolute path (no query) of every target the proxy may relay. */
    private static final Pattern TARGET_PATH =
        Pattern.compile("^/api/(audiobooks/[0-9]+/(stream|cover)|tracks/[0-9]+/stream)$");

    /** Hosts are LAN/production hosts; no brackets (IPv6 literals unsupported). */
    private static final Pattern TARGET_HOST = Pattern.compile("^[A-Za-z0-9._-]+$");

    private MediaProxy() {}

    /**
     * Whether `url` is shaped like a media-proxy URL (https origin, `/_media`),
     * regardless of whether its target is valid. Used to decide between
     * answering 400 and delegating to the asset loader.
     */
    public static boolean isProxyShaped(String url) {
        if (url == null || url.isEmpty()) return false;
        try {
            URI u = new URI(url);
            return "https".equalsIgnoreCase(u.getScheme())
                && u.getHost() != null && PROXY_HOST.equalsIgnoreCase(u.getHost())
                && PROXY_PATH.equals(u.getPath());
        } catch (URISyntaxException e) {
            return false;
        }
    }

    /**
     * Extract and validate the inner target URL from a proxy URL.
     *
     * Returns null for anything that is not a well-formed proxy URL naming an
     * allowed target: wrong scheme (the app origin is always https), wrong
     * host/path, missing or duplicated `url` param, extra params, or a target
     * that fails {@link #isAllowedTarget}. Fail closed — the caller answers
     * 400/502, never falls back to a direct network load of the proxy URL.
     */
    public static String innerUrl(String proxyUrl) {
        if (proxyUrl == null || proxyUrl.isEmpty()) return null;
        final URI proxy;
        try {
            proxy = new URI(proxyUrl);
        } catch (URISyntaxException e) {
            return null;
        }
        if (!"https".equalsIgnoreCase(proxy.getScheme())) return null;
        if (proxy.getHost() == null || !PROXY_HOST.equalsIgnoreCase(proxy.getHost())) return null;
        if (!PROXY_PATH.equals(proxy.getPath())) return null;
        if (proxy.getFragment() != null) return null;

        String query = proxy.getRawQuery();
        if (query == null || query.isEmpty()) return null;
        String innerRaw = null;
        for (String part : query.split("&")) {
            if (part.startsWith("url=")) {
                if (innerRaw != null) return null; // duplicated param: ambiguous
                innerRaw = part.substring("url=".length());
            } else {
                return null; // strict: no other params on this URL
            }
        }
        if (innerRaw == null) return null;
        final String inner;
        try {
            inner = URLDecoder.decode(innerRaw, StandardCharsets.UTF_8.name());
        } catch (java.io.UnsupportedEncodingException | IllegalArgumentException e) {
            return null; // bad percent-encoding
        }
        return isAllowedTarget(inner) ? inner : null;
    }

    /**
     * Whether the proxy may relay `url`: absolute http/https, no userinfo, a
     * plain DNS/IP host, and a path under the media surface only. Query is
     * unconstrained (it carries the short-lived media token); fragment is not
     * sent over HTTP and has no place here.
     */
    public static boolean isAllowedTarget(String url) {
        if (url == null || url.isEmpty()) return false;
        final URI target;
        try {
            target = new URI(url);
        } catch (URISyntaxException e) {
            return false;
        }
        String scheme = target.getScheme();
        if (scheme == null) return false;
        scheme = scheme.toLowerCase(Locale.ROOT);
        if (!scheme.equals("http") && !scheme.equals("https")) return false;
        if (target.getUserInfo() != null) return false;
        String host = target.getHost();
        if (host == null || !TARGET_HOST.matcher(host).matches()) return false;
        int port = target.getPort();
        if (port > 65535) return false; // URI already rejects < -1
        String path = target.getPath();
        if (path == null || !TARGET_PATH.matcher(path).matches()) return false;
        return target.getFragment() == null;
    }

    /**
     * Headers the WebView request may contribute: `Range` (seeks) and `Accept`.
     * Everything else is dropped — in particular Origin/Cookie/X-House-Session
     * never cross origins through this proxy; the media token is the credential.
     */
    public static Map<String, String> forwardedRequestHeaders(Map<String, String> incoming) {
        Map<String, String> out = new LinkedHashMap<>();
        if (incoming == null) return out;
        for (Map.Entry<String, String> entry : incoming.entrySet()) {
            String name = entry.getKey();
            String value = entry.getValue();
            if (name == null || value == null) continue;
            value = value.trim();
            if (value.isEmpty()) continue;
            String lower = name.trim().toLowerCase(Locale.ROOT);
            if (lower.equals("range")) out.put("Range", value);
            else if (lower.equals("accept")) out.put("Accept", value);
        }
        return out;
    }

    /**
     * Headers to pass from the server response back to the WebView. Content-Type
     * travels via the WebResourceResponse's mimeType parameter instead of here.
     */
    public static Map<String, String> responseHeaders(Map<String, String> serverHeaders) {
        Map<String, String> out = new LinkedHashMap<>();
        if (serverHeaders == null) return out;
        Map<String, String> lower = new HashMap<>();
        for (Map.Entry<String, String> entry : serverHeaders.entrySet()) {
            if (entry.getKey() != null && entry.getValue() != null) {
                String value = entry.getValue().trim();
                if (!value.isEmpty()) lower.put(entry.getKey().trim().toLowerCase(Locale.ROOT), value);
            }
        }
        putIfPresent(out, lower, "content-length", "Content-Length");
        putIfPresent(out, lower, "content-range", "Content-Range");
        putIfPresent(out, lower, "accept-ranges", "Accept-Ranges");
        putIfPresent(out, lower, "cache-control", "Cache-Control");
        putIfPresent(out, lower, "etag", "ETag");
        putIfPresent(out, lower, "last-modified", "Last-Modified");
        return out;
    }

    /** MIME type for the WebResourceResponse; the stream endpoints always send audio/mpeg. */
    public static String contentType(Map<String, String> serverHeaders) {
        if (serverHeaders == null) return "audio/mpeg";
        for (Map.Entry<String, String> entry : serverHeaders.entrySet()) {
            if (entry.getKey() == null || entry.getValue() == null) continue;
            if (entry.getKey().trim().equalsIgnoreCase("content-type")) {
                String value = entry.getValue().split(";", 2)[0].trim();
                if (!value.isEmpty()) return value;
            }
        }
        return "audio/mpeg";
    }

    public static String reasonPhrase(int status) {
        switch (status) {
            case 200: return "OK";
            case 206: return "Partial Content";
            case 304: return "Not Modified";
            case 400: return "Bad Request";
            case 401: return "Unauthorized";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 416: return "Range Not Satisfiable";
            case 500: return "Internal Server Error";
            case 502: return "Bad Gateway";
            case 503: return "Service Unavailable";
            case 504: return "Gateway Timeout";
            default: return "Status";
        }
    }

    private static void putIfPresent(
        Map<String, String> out, Map<String, String> lower, String from, String to) {
        String value = lower.get(from);
        if (value != null) out.put(to, value);
    }
}
