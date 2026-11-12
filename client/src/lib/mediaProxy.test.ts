import { describe, expect, it } from "vitest";
import { MEDIA_PROXY_PREFIX, mediaProxyUrl } from "./mediaProxy";

/**
 * The native media proxy (`https://localhost/_media`) is how the Android shell
 * serves plain-HTTP/HTTPS media to the media element without Chrome's
 * mixed-content auto-upgrade killing the request. These tests pin the URL
 * shape both sides rely on; the Java half of the contract is tested in
 * `client/android/.../MediaProxyTest.java`. Change both together.
 */
describe("mediaProxyUrl", () => {
  it("wraps an absolute http URL in the proxy prefix", () => {
    const url = "http://192.168.1.203:3000/api/audiobooks/5/stream?media=tok";
    expect(mediaProxyUrl(url)).toBe(`${MEDIA_PROXY_PREFIX}${encodeURIComponent(url)}`);
  });

  it("wraps an absolute https URL (production instance)", () => {
    const url = "https://audiobook-manager.onrender.com/api/tracks/12/stream?media=tok";
    expect(mediaProxyUrl(url)).toBe(`${MEDIA_PROXY_PREFIX}${encodeURIComponent(url)}`);
  });

  it("encodes a query-bearing URL exactly once and round-trips", () => {
    const url = "http://server:3000/api/tracks/7/stream?media=abc&x=1&y=2";
    const proxied = mediaProxyUrl(url);
    expect(proxied.startsWith(MEDIA_PROXY_PREFIX)).toBe(true);
    expect(decodeURIComponent(proxied.slice(MEDIA_PROXY_PREFIX.length))).toBe(url);
  });

  it("wraps the scheme case-insensitively", () => {
    expect(mediaProxyUrl("HTTP://server:3000/api/audiobooks/1/stream")).toBe(
      `${MEDIA_PROXY_PREFIX}${encodeURIComponent("HTTP://server:3000/api/audiobooks/1/stream")}`,
    );
  });

  it.each([
    "/api/audiobooks/5/stream", // relative: already resolved against the WebView origin
    "", // nothing to wrap
    "capacitor-file://book/41.mp3", // device-local file, not mixed content
    "blob:https://localhost/1234", // in-memory blob
    "data:audio/mpeg;base64,AAAA", // data URI
    "ftp://server/api/audiobooks/5/stream", // not http(s): native layer cannot proxy it either
  ])("returns %s unchanged", (url) => {
    expect(mediaProxyUrl(url)).toBe(url);
  });
});
