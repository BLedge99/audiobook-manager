package com.technative.audiobookmanager;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.UnsupportedEncodingException;
import java.net.URLEncoder;
import java.util.HashMap;
import java.util.Map;
import org.junit.Test;

/**
 * The Java half of the media-proxy contract. `MediaProxy` holds the pure
 * logic (URL validation, allowlist, header whitelists); the WebView hook
 * lives in `MediaProxyWebViewClient` and is not unit-testable here.
 *
 * Keep these cases in sync with `client/src/lib/mediaProxy.test.ts`.
 */
public class MediaProxyTest {
    private static String proxyUrl(String inner) {
        try {
            return "https://localhost/_media?url=" + URLEncoder.encode(inner, "UTF-8")
                .replace("+", "%20");
        } catch (UnsupportedEncodingException e) {
            throw new IllegalStateException(e);
        }
    }

    // ---- innerUrl: extraction and validation of the target ----

    @Test
    public void acceptsTrackStreamTarget() {
        String inner = "http://10.10.9.19:3001/api/tracks/1/stream?media=abc";
        assertEquals(inner, MediaProxy.innerUrl(proxyUrl(inner)));
    }

    @Test
    public void acceptsBookStreamTargetWithoutMediaParam() {
        String inner = "http://server:3000/api/audiobooks/5/stream";
        assertEquals(inner, MediaProxy.innerUrl(proxyUrl(inner)));
    }

    @Test
    public void acceptsBookCoverTarget() {
        String inner = "http://server:3000/api/audiobooks/5/cover?media=tok";
        assertEquals(inner, MediaProxy.innerUrl(proxyUrl(inner)));
    }

    @Test
    public void acceptsHttpsTarget() {
        String inner = "https://audiobook-manager.onrender.com/api/audiobooks/5/stream?media=tok";
        assertEquals(inner, MediaProxy.innerUrl(proxyUrl(inner)));
    }

    @Test
    public void acceptsTargetWithQueryAndNoMediaToken() {
        String inner = "http://server:3000/api/tracks/7/stream";
        assertEquals(inner, MediaProxy.innerUrl(proxyUrl(inner)));
    }

    @Test
    public void rejectsHttpSchemeProxyOrigin() {
        assertNull(MediaProxy.innerUrl("http://localhost/_media?url=" + encode("http://h/api/tracks/1/stream")));
    }

    @Test
    public void rejectsProxyOnForeignHost() {
        assertNull(MediaProxy.innerUrl("https://evil.example/_media?url=" + encode("http://h/api/tracks/1/stream")));
    }

    @Test
    public void rejectsProxyWithWrongPath() {
        assertNull(MediaProxy.innerUrl("https://localhost/_other?url=" + encode("http://h/api/tracks/1/stream")));
    }

    @Test
    public void rejectsMissingUrlParam() {
        assertNull(MediaProxy.innerUrl("https://localhost/_media"));
        assertNull(MediaProxy.innerUrl("https://localhost/_media?"));
    }

    @Test
    public void rejectsEmptyUrlParam() {
        assertNull(MediaProxy.innerUrl("https://localhost/_media?url="));
    }

    @Test
    public void rejectsRelativeTargets() {
        assertNull(MediaProxy.innerUrl("https://localhost/_media?url=" + encode("/api/tracks/1/stream")));
    }

    @Test
    public void rejectsNonHttpSchemes() {
        assertNull(MediaProxy.innerUrl(proxyUrl("ftp://h/api/tracks/1/stream")));
        assertNull(MediaProxy.innerUrl(proxyUrl("file:///etc/passwd")));
        assertNull(MediaProxy.innerUrl(proxyUrl("capacitor-file://book/1.mp3")));
        assertNull(MediaProxy.innerUrl(proxyUrl("content://com.x/file")));
    }

    @Test
    public void rejectsTargetsWithUserInfo() {
        assertNull(MediaProxy.innerUrl(proxyUrl("http://user:pass@h/api/tracks/1/stream")));
    }

    @Test
    public void rejectsDisallowedPaths() {
        assertNull(MediaProxy.innerUrl(proxyUrl("http://h/api/admin/users")));
        assertNull(MediaProxy.innerUrl(proxyUrl("http://h/api/audiobooks/abc/stream")));
        assertNull(MediaProxy.innerUrl(proxyUrl("http://h/api/audiobooks/5/streamx")));
        assertNull(MediaProxy.innerUrl(proxyUrl("http://h/api/tracks/1/streamx")));
        assertNull(MediaProxy.innerUrl(proxyUrl("http://h/api/audiobooks/5/progress")));
        assertNull(MediaProxy.innerUrl(proxyUrl("http://h/api/tracks/1/cover"))); // tracks have no cover
        assertNull(MediaProxy.innerUrl(proxyUrl("http://h/api/health")));
    }

    @Test
    public void rejectsEncodedTraversalInPath() {
        assertNull(MediaProxy.innerUrl(proxyUrl("http://h/api/audiobooks/1/stream/../../admin")));
        assertNull(MediaProxy.innerUrl("https://localhost/_media?url=" + encode("http://h/api/audiobooks/1/stream%2F..%2F..%2Fadmin")));
    }

    @Test
    public void rejectsAmbiguousDuplicateParams() {
        String enc = encode("http://h/api/tracks/1/stream");
        assertNull(MediaProxy.innerUrl("https://localhost/_media?url=" + enc + "&url=" + enc));
    }

    @Test
    public void rejectsExtraParams() {
        String enc = encode("http://h/api/tracks/1/stream");
        assertNull(MediaProxy.innerUrl("https://localhost/_media?url=" + enc + "&x=1"));
    }

    @Test
    public void rejectsGarbage() {
        assertNull(MediaProxy.innerUrl(null));
        assertNull(MediaProxy.innerUrl(""));
        assertNull(MediaProxy.innerUrl("not a url"));
        assertNull(MediaProxy.innerUrl("https://localhost/_media?url=%zz"));
    }

    // ---- isAllowedTarget: direct checks used by the interceptor ----

    @Test
    public void allowlistMatchesOnlyTheMediaSurface() {
        assertTrue(MediaProxy.isAllowedTarget("http://h:3000/api/audiobooks/12/stream"));
        assertTrue(MediaProxy.isAllowedTarget("http://h/api/audiobooks/12/cover"));
        assertTrue(MediaProxy.isAllowedTarget("http://h/api/tracks/34/stream?media=y"));
        assertTrue(MediaProxy.isAllowedTarget("https://h/api/audiobooks/1/stream"));
        assertFalse(MediaProxy.isAllowedTarget("http://h/api/tracks/34/stream/"));
        assertFalse(MediaProxy.isAllowedTarget("http://h/api/audiobooks/01/streamextra"));
    }

    // ---- forwardedRequestHeaders: only Range and Accept cross over ----

    @Test
    public void forwardsOnlyRangeAndAccept() {
        Map<String, String> incoming = new HashMap<>();
        incoming.put("Range", "bytes=0-");
        incoming.put("accept", "audio/mpeg");
        incoming.put("Origin", "https://localhost");
        incoming.put("Cookie", "house_session=secret");
        incoming.put("X-House-Session", "secret");
        incoming.put("Referer", "https://localhost/");
        Map<String, String> out = MediaProxy.forwardedRequestHeaders(incoming);
        assertEquals("bytes=0-", out.get("Range"));
        assertEquals("audio/mpeg", out.get("Accept"));
        assertEquals(2, out.size());
    }

    @Test
    public void forwardedHeadersAreCaseInsensitiveAndCanonicalised() {
        Map<String, String> incoming = new HashMap<>();
        incoming.put("RANGE", "bytes=100-200");
        incoming.put("Accept", "bytes");
        Map<String, String> out = MediaProxy.forwardedRequestHeaders(incoming);
        assertEquals("bytes=100-200", out.get("Range"));
        assertEquals("bytes", out.get("Accept"));
    }

    @Test
    public void emptyRangeHeaderIsDropped() {
        Map<String, String> incoming = new HashMap<>();
        incoming.put("Range", "");
        incoming.put("Accept", "");
        assertTrue(MediaProxy.forwardedRequestHeaders(incoming).isEmpty());
    }

    // ---- responseHeaders: only the whitelist passes back to the WebView ----

    @Test
    public void responseHeadersPassThroughWhitelistOnly() {
        Map<String, String> server = new HashMap<>();
        server.put("Content-Type", "audio/mpeg");
        server.put("Content-Length", "1000");
        server.put("Content-Range", "bytes 0-999/2000");
        server.put("Accept-Ranges", "bytes");
        server.put("Cache-Control", "no-store");
        server.put("ETag", "\"abc\"");
        server.put("Set-Cookie", "house_session=secret");
        server.put("Connection", "keep-alive");
        server.put("Transfer-Encoding", "chunked");
        server.put("Content-Encoding", "gzip");
        Map<String, String> out = MediaProxy.responseHeaders(server);
        assertEquals("1000", out.get("Content-Length"));
        assertEquals("bytes 0-999/2000", out.get("Content-Range"));
        assertEquals("bytes", out.get("Accept-Ranges"));
        assertEquals("no-store", out.get("Cache-Control"));
        assertEquals("\"abc\"", out.get("ETag"));
        assertFalse(out.containsKey("Set-Cookie"));
        assertFalse(out.containsKey("Connection"));
        assertFalse(out.containsKey("Transfer-Encoding"));
        assertFalse(out.containsKey("Content-Encoding"));
    }

    // ---- contentType: what the WebView gets told the bytes are ----

    @Test
    public void contentTypeStripsParameters() {
        Map<String, String> server = new HashMap<>();
        server.put("Content-Type", "audio/mpeg; charset=binary");
        assertEquals("audio/mpeg", MediaProxy.contentType(server));
    }

    @Test
    public void contentTypeDefaultsToAudioMpeg() {
        assertEquals("audio/mpeg", MediaProxy.contentType(new HashMap<>()));
        assertEquals("audio/mpeg", MediaProxy.contentType(null));
    }

    // ---- isProxyShaped: is this a /_media URL at all (target valid or not) ----

    @Test
    public void proxyShapedMatchesOnlyTheAppOriginMediaPath() {
        assertTrue(MediaProxy.isProxyShaped("https://localhost/_media?url=whatever"));
        assertTrue(MediaProxy.isProxyShaped("https://localhost/_media")); // shape, not validity
        assertFalse(MediaProxy.isProxyShaped("http://localhost/_media?url=whatever"));
        assertFalse(MediaProxy.isProxyShaped("https://evil.example/_media?url=whatever"));
        assertFalse(MediaProxy.isProxyShaped("https://localhost/_other?url=whatever"));
        assertFalse(MediaProxy.isProxyShaped("https://localhost/api/tracks/1/stream"));
        assertFalse(MediaProxy.isProxyShaped(null));
        assertFalse(MediaProxy.isProxyShaped(""));
    }

    // ---- reasonPhrase ----

    @Test
    public void reasonPhrasesAreMapped() {
        assertEquals("OK", MediaProxy.reasonPhrase(200));
        assertEquals("Partial Content", MediaProxy.reasonPhrase(206));
        assertEquals("Not Modified", MediaProxy.reasonPhrase(304));
        assertEquals("Bad Request", MediaProxy.reasonPhrase(400));
        assertEquals("Unauthorized", MediaProxy.reasonPhrase(401));
        assertEquals("Forbidden", MediaProxy.reasonPhrase(403));
        assertEquals("Not Found", MediaProxy.reasonPhrase(404));
        assertEquals("Range Not Satisfiable", MediaProxy.reasonPhrase(416));
        assertEquals("Internal Server Error", MediaProxy.reasonPhrase(500));
        assertEquals("Bad Gateway", MediaProxy.reasonPhrase(502));
        assertEquals("Status", MediaProxy.reasonPhrase(799));
    }

    private static String encode(String value) {
        try {
            return URLEncoder.encode(value, "UTF-8").replace("+", "%20");
        } catch (UnsupportedEncodingException e) {
            throw new IllegalStateException(e);
        }
    }
}
