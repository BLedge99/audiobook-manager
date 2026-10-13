import { beforeEach, describe, expect, it } from "vitest";
import {
  apiAssetUrl,
  apiFetch,
  apiUrl,
  clearServerUrl,
  getServerUrl,
  needsServerUrl,
  normaliseServerUrl,
  SERVER_URL_KEY,
  setServerUrl,
} from "./api";

/** Simulate the Capacitor bridge, which App.tsx reads defensively. */
function setNativeShell(isNative: boolean) {
  (window as unknown as { Capacitor?: unknown }).Capacitor = isNative
    ? { isNativePlatform: () => true }
    : { isNativePlatform: () => false };
}

describe("normaliseServerUrl", () => {
  it("keeps a well-formed URL but drops the trailing slash", () => {
    expect(normaliseServerUrl("http://192.168.1.203:3000/")).toBe("http://192.168.1.203:3000");
  });

  it("supplies http:// when the user omits the scheme", () => {
    // The realistic phone typo. Rejecting it would be user-hostile for a
    // household tool where the address is typed by hand.
    expect(normaliseServerUrl("192.168.1.203:3000")).toBe("http://192.168.1.203:3000");
  });

  it("trims surrounding whitespace", () => {
    expect(normaliseServerUrl("  http://home.local:3000  ")).toBe("http://home.local:3000");
  });

  it("preserves https rather than downgrading it", () => {
    expect(normaliseServerUrl("https://books.example.com")).toBe("https://books.example.com");
  });

  it("returns empty for blank input, meaning unconfigured", () => {
    expect(normaliseServerUrl("")).toBe("");
    expect(normaliseServerUrl("   ")).toBe("");
    expect(normaliseServerUrl(null)).toBe("");
    expect(normaliseServerUrl(undefined)).toBe("");
  });

  it("returns empty for input that cannot become a URL", () => {
    expect(normaliseServerUrl("http://")).toBe("");
    expect(normaliseServerUrl("::::")).toBe("");
  });
});

describe("apiUrl", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setNativeShell(false);
  });

  it("leaves paths relative when no server is configured", () => {
    // This is what keeps the browser, the dev server and every existing test
    // behaving exactly as they did before spec 26.
    expect(apiUrl("/api/audiobooks")).toBe("/api/audiobooks");
  });

  it("prefixes the configured server when there is one", () => {
    setServerUrl("http://192.168.1.203:3000");
    expect(apiUrl("/api/audiobooks")).toBe("http://192.168.1.203:3000/api/audiobooks");
  });

  it("adds the missing slash for a bare path", () => {
    setServerUrl("http://192.168.1.203:3000");
    expect(apiUrl("api/audiobooks")).toBe("http://192.168.1.203:3000/api/audiobooks");
  });

  it("round-trips through storage", () => {
    setServerUrl("192.168.1.203:3000/");
    expect(getServerUrl()).toBe("http://192.168.1.203:3000");
    expect(window.localStorage.getItem(SERVER_URL_KEY)).toBe("http://192.168.1.203:3000");
  });

  it("refuses to store an unusable URL", () => {
    expect(() => setServerUrl("http://")).toThrow(/server address/i);
  });

  it("clears back to relative URLs", () => {
    setServerUrl("http://192.168.1.203:3000");
    clearServerUrl();
    expect(apiUrl("/api/audiobooks")).toBe("/api/audiobooks");
  });
});

describe("apiAssetUrl", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("points cover art at the configured server", () => {
    // The server returns "/api/covers/1.jpg", which in the Android shell would
    // otherwise resolve against the phone's own https://localhost origin.
    setServerUrl("http://192.168.1.203:3000");
    expect(apiAssetUrl("/api/covers/1.jpg")).toBe("http://192.168.1.203:3000/api/covers/1.jpg");
  });

  it("leaves an already-absolute URL alone", () => {
    setServerUrl("http://192.168.1.203:3000");
    expect(apiAssetUrl("https://covers.example.com/a.jpg")).toBe("https://covers.example.com/a.jpg");
  });
});

describe("needsServerUrl", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("is true on Android with nothing configured", () => {
    setNativeShell(true);
    expect(needsServerUrl()).toBe(true);
  });

  it("is false on Android once a server is set", () => {
    setNativeShell(true);
    setServerUrl("http://192.168.1.203:3000");
    expect(needsServerUrl()).toBe(false);
  });

  it("is false in a browser, which uses the dev-server proxy", () => {
    setNativeShell(false);
    expect(needsServerUrl()).toBe(false);
  });
});

describe("apiFetch", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.removeItem("profileId");
  });

  it("sends the profile header so progress stays profile-scoped", async () => {
    window.localStorage.setItem("profileId", "7");
    const calls: { url: string; init?: RequestInit }[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = ((input: string, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return Promise.resolve(new Response("[]", { status: 200 }));
    }) as typeof fetch;

    try {
      await apiFetch("/api/audiobooks");
    } finally {
      globalThis.fetch = original;
    }

    expect(calls[0].url).toBe("/api/audiobooks");
    expect((calls[0].init?.headers as Record<string, string>)["x-profile-id"]).toBe("7");
  });

  it("surfaces the server's message on failure", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(new Response(JSON.stringify({ message: "Invalid range" }), { status: 416 }))) as typeof fetch;

    try {
      await expect(apiFetch("/api/audiobooks/1/stream")).rejects.toThrow("Invalid range");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("falls back to the raw body when the error is not JSON", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (() => Promise.resolve(new Response("<html>oops</html>", { status: 502 }))) as typeof fetch;

    try {
      await expect(apiFetch("/api/audiobooks")).rejects.toThrow("<html>oops</html>");
    } finally {
      globalThis.fetch = original;
    }
  });
});