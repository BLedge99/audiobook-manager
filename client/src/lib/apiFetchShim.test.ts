import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installApiBaseUrl, onServerUnreachable, resolveApiRequest, setServerUrl, setSessionToken } from "./api";
import { TEST_SERVER_URL } from "../test/constants";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  // The installer replaces window.fetch for the whole jsdom instance, so it has
  // to be undone or it leaks into every later test file.
  (window as unknown as Record<string, unknown>).__audiobookApiBaseInstalled = false;
  vi.restoreAllMocks();
});

describe("resolveApiRequest", () => {
  it("rewrites a bare API path against the configured server", () => {
    setServerUrl(TEST_SERVER_URL);
    expect(resolveApiRequest("/api/audiobooks")).toBe(`${TEST_SERVER_URL}/api/audiobooks`);
  });

  it("leaves the path alone when no server is configured", () => {
    // Dev server and PWA behaviour must be byte-identical to before spec 26.
    expect(resolveApiRequest("/api/audiobooks")).toBe("/api/audiobooks");
  });

  it("never rewrites an absolute http URL", () => {
    // The dangerous case: a naive wrapper turns this into
    // "<server>http://<server>/api/x" and every call 404s.
    setServerUrl(TEST_SERVER_URL);
    const url = `${TEST_SERVER_URL}/api/audiobooks`;
    expect(resolveApiRequest(url)).toBe(url);
  });

  it("never rewrites a capacitor-file URL for local audio", () => {
    // A downloaded track's playable URL is not an API call. Prefixing it would
    // point <audio> at the server and break offline playback entirely.
    setServerUrl(TEST_SERVER_URL);
    const url = "capacitor-file://_capacitor_file_/books%2F7%2F70.mp3";
    expect(resolveApiRequest(url)).toBe(url);
  });

  it("leaves blob and data URLs alone", () => {
    setServerUrl(TEST_SERVER_URL);
    expect(resolveApiRequest("blob:capacitor://localhost/abc")).toBe("blob:capacitor://localhost/abc");
    expect(resolveApiRequest("data:audio/mp3;base64,AA")).toBe("data:audio/mp3;base64,AA");
  });

  it("leaves a protocol-relative URL alone", () => {
    setServerUrl(TEST_SERVER_URL);
    expect(resolveApiRequest("//example.com/x")).toBe("//example.com/x");
  });

  it("resolves a URL object", () => {
    setServerUrl(TEST_SERVER_URL);
    const url = new URL(`${TEST_SERVER_URL}/api/audiobooks`);
    expect(resolveApiRequest(url)).toBe(url);
  });
});

describe("installApiBaseUrl", () => {
  it("rewrites fetches that go through window.fetch", async () => {
    const calls: string[] = [];
    const original = window.fetch;
    window.fetch = ((input: RequestInfo | URL) => {
      calls.push(typeof input === "string" ? input : String(input));
      return Promise.resolve(new Response("[]", { status: 200 }));
    }) as typeof fetch;

    try {
      setServerUrl(TEST_SERVER_URL);
      installApiBaseUrl();
      await fetch("/api/audiobooks");
      expect(calls[0]).toBe(`${TEST_SERVER_URL}/api/audiobooks`);
    } finally {
      window.fetch = original;
    }
  });

  it("sends credentials on every fetch, including ones that bypass apiFetch", async () => {
    // This is the regression guard that matters. `apiFetch` had its own
    // credentials and its own passing test, yet most of the app calls fetch
    // directly via its own per-module `request` helpers -- so the cookie never
    // travelled and the Android app 401'd on everything. The shim is the only
    // choke point every call passes through, so the fix has to live here.
    const inits: (RequestInit | undefined)[] = [];
    const original = window.fetch;
    window.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      inits.push(init);
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as typeof fetch;

    try {
      installApiBaseUrl();
      // A raw call of the shape several modules actually use.
      await fetch("/api/audiobooks", { headers: { "x-profile-id": "7" } });
    } finally {
      window.fetch = original;
    }

    expect(inits[0]?.credentials).toBe("include");
  });

  it("sends the in-memory native session as a header on every fetch", async () => {
    // The cookie cannot cross from the https://localhost WebView to an http://
    // API -- Chrome drops it, so every post-login call 401'd. This is the
    // mechanism that replaced it.
    const inits: (RequestInit | undefined)[] = [];
    const original = window.fetch;
    window.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      inits.push(init);
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as typeof fetch;

    try {
      Object.defineProperty(window, "Capacitor", { configurable: true, value: { isNativePlatform: () => true } });
      setSessionToken("tok-123");
      installApiBaseUrl();
      await fetch("/api/audiobooks");
    } finally {
      window.fetch = original;
      setSessionToken(undefined);
      delete (window as unknown as { Capacitor?: unknown }).Capacitor;
    }

    const headers = inits[0]?.headers as Record<string, string>;
    expect(headers["x-house-session"]).toBe("tok-123");
  });

  it("does not overwrite a session header the caller already set", async () => {
    const inits: (RequestInit | undefined)[] = [];
    const original = window.fetch;
    window.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      inits.push(init);
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as typeof fetch;

    try {
      Object.defineProperty(window, "Capacitor", { configurable: true, value: { isNativePlatform: () => true } });
      setSessionToken("stored-token");
      installApiBaseUrl();
      await fetch("/api/audiobooks", { headers: { "x-house-session": "explicit" } });
    } finally {
      window.fetch = original;
      setSessionToken(undefined);
      delete (window as unknown as { Capacitor?: unknown }).Capacitor;
    }

    const headers = inits[0]?.headers as Record<string, string>;
    expect(headers["x-house-session"]).toBe("explicit");
  });

  it("reports the server as unreachable when a request cannot be answered", async () => {
    // The app used to learn the server was gone only from a probe, and the
    // probe only ran at startup and on window focus. A phone that lost the
    // server went on showing the shelf it had loaded, with buttons that
    // looked alive and silently did nothing -- which is what the household
    // reported. A failed request is the same fact, noticed sooner.
    const original = window.fetch;
    window.fetch = (() => Promise.reject(new TypeError("Failed to fetch"))) as typeof fetch;
    let reported = 0;
    const stop = onServerUnreachable(() => {
      reported += 1;
    });

    try {
      installApiBaseUrl();
      await expect(fetch("/api/audiobooks")).rejects.toThrow();
      expect(reported).toBe(1);
    } finally {
      stop();
      window.fetch = original;
    }
  });

  it("does not report it when the server answered with an error", async () => {
    // A 500 is the server talking. It is a different problem with a different
    // fix, and the app must not go offline because of it.
    const original = window.fetch;
    window.fetch = (() => Promise.resolve(new Response("{}", { status: 500 }))) as typeof fetch;
    let reported = 0;
    const stop = onServerUnreachable(() => {
      reported += 1;
    });

    try {
      installApiBaseUrl();
      await fetch("/api/audiobooks");
      expect(reported).toBe(0);
    } finally {
      stop();
      window.fetch = original;
    }
  });

  it("installs only once, so fetch is not wrapped twice", () => {
    const original = window.fetch;
    const inner = vi.fn(async () => new Response("[]", { status: 200 }));
    window.fetch = inner as unknown as typeof fetch;

    try {
      const first = window.fetch;
      installApiBaseUrl();
      const second = window.fetch;
      installApiBaseUrl();
      // A second wrap would make each request go through two shims, and the
      // guard keeps that from happening on a re-render or hot reload.
      expect(window.fetch).toBe(second);
      expect(second).not.toBe(first);
    } finally {
      window.fetch = original;
    }
  });
});
