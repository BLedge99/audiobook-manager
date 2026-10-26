import { describe, it, expect, beforeEach, vi } from "vitest";
import { clearServerUrl, coverUrl, setServerUrl, setSessionToken } from "./api";

/**
 * Covers were silently broken in the Android shell for two independent reasons,
 * and both surface as the same placeholder image:
 *
 *  1. `AudiobookGrid` and `Shelves` built a bare `/api/audiobooks/N/cover`,
 *     which resolves against the WebView's `https://localhost` origin and
 *     returns the bundled index.html rather than an image.
 *  2. Native image requests use a scoped media token. Browser images use the
 *     same-origin HttpOnly cookie and never expose the session token in a URL.
 *
 * The server is fine: 11 of 12 books have a cover file and the endpoint returns
 * 200 with image bytes, so this is purely a client-side URL bug.
 */
describe("coverUrl", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("points at the configured server in the Android shell", async () => {
    setServerUrl("http://192.168.1.203:3000");
    setSessionToken(undefined);
    expect(await coverUrl(7)).toBe("http://192.168.1.203:3000/api/audiobooks/7/cover");
  });

  it("does not put a browser session token in the cover URL", async () => {
    setServerUrl("http://192.168.1.203:3000");
    setSessionToken("tok-123");
    expect(await coverUrl(7)).toBe("http://192.168.1.203:3000/api/audiobooks/7/cover");
  });

  it("stays relative in the browser", async () => {
    clearServerUrl();
    setSessionToken(undefined);
    expect(await coverUrl(7)).toBe("/api/audiobooks/7/cover");
  });

  it("uses a scoped media token in native image URLs", async () => {
    Object.defineProperty(window, "Capacitor", { configurable: true, value: { isNativePlatform: () => true } });
    setServerUrl("http://192.168.1.203:3000");
    setSessionToken("session-secret");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ token: "scoped-token" }) });
    vi.stubGlobal("fetch", fetchMock);

    expect(await coverUrl(7)).toBe("http://192.168.1.203:3000/api/audiobooks/7/cover?media=scoped-token");
    expect(fetchMock).toHaveBeenCalledWith("http://192.168.1.203:3000/api/auth/media-token", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ kind: "cover", id: 7 }),
    }));

    vi.unstubAllGlobals();
    setSessionToken(undefined);
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  });
});
