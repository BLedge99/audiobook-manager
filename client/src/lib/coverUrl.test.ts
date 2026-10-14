import { describe, it, expect, beforeEach } from "vitest";
import { clearServerUrl, coverUrl, setServerUrl, setSessionToken } from "./api";

/**
 * Covers were silently broken in the Android shell for two independent reasons,
 * and both surface as the same placeholder image:
 *
 *  1. `AudiobookGrid` and `Shelves` built a bare `/api/audiobooks/N/cover`,
 *     which resolves against the WebView's `https://localhost` origin and
 *     returns the bundled index.html rather than an image.
 *  2. An `<img src>` request cannot send the session header, so even a correct
 *     URL 401'd -- the same limitation as `<audio src>`.
 *
 * The server is fine: 11 of 12 books have a cover file and the endpoint returns
 * 200 with image bytes, so this is purely a client-side URL bug.
 */
describe("coverUrl", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("points at the configured server in the Android shell", () => {
    setServerUrl("http://192.168.1.203:3000");
    setSessionToken(undefined);
    expect(coverUrl(7)).toBe("http://192.168.1.203:3000/api/audiobooks/7/cover");
  });

  it("carries the session token, because an img cannot send a header", () => {
    setServerUrl("http://192.168.1.203:3000");
    setSessionToken("tok-123");
    expect(coverUrl(7)).toBe("http://192.168.1.203:3000/api/audiobooks/7/cover?session=tok-123");
  });

  it("stays relative in the browser, unchanged", () => {
    clearServerUrl();
    setSessionToken(undefined);
    expect(coverUrl(7)).toBe("/api/audiobooks/7/cover");
  });
});