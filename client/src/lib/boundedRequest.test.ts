import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boundedFetch, onServerUnreachable, SESSION_HEADER, setServerUrl } from "./api";
import { TEST_SERVER_URL } from "../test/constants";

/**
 * A bounded request is self-sufficient.
 *
 * The global `window.fetch` patch used to be what made a request *work*: it
 * resolved the base URL, attached the session token and set the credentials.
 * That made the guarantee a property of the environment rather than of the
 * call, and it meant a module that used `boundedFetch` was correct only
 * because something else had run first.
 *
 * These tests hold the opposite line: the request owns its own guarantees, so
 * they hold whether or not anything has been installed.
 */

let calls: { url: string; init?: RequestInit }[];
let original: typeof globalThis.fetch;

beforeEach(() => {
  calls = [];
  original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: typeof input === "string" ? input : String(input), init });
    return Promise.resolve(new Response("[]", { status: 200 }));
  }) as typeof fetch;
  window.localStorage.clear();
  setServerUrl(TEST_SERVER_URL);
});

afterEach(() => {
  globalThis.fetch = original;
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("a bounded request owns its guarantees", () => {
  it("resolves the path against the configured server", async () => {
    await boundedFetch("/api/audiobooks");

    expect(calls[0].url).toBe(`${TEST_SERVER_URL}/api/audiobooks`);
  });

  it("asks for credentials, so the session cookie travels", async () => {
    await boundedFetch("/api/audiobooks");

    expect(calls[0].init?.credentials).toBe("include");
  });

  it("attaches the session header in the native shell", async () => {
    (window as unknown as { Capacitor?: unknown }).Capacitor = {
      isNativePlatform: () => true,
    };
    const { setSessionToken } = await import("./api");
    setSessionToken("token-abc");

    await boundedFetch("/api/audiobooks");

    expect((calls[0].init?.headers as Record<string, string>)[SESSION_HEADER]).toBe("token-abc");
  });

  it("leaves an already-absolute URL alone", async () => {
    await boundedFetch("http://other-server:3000/api/health");

    expect(calls[0].url).toBe("http://other-server:3000/api/health");
  });

  it("does not need the global patch to have been installed", async () => {
    // The regression this guards: the app's own module-level `fetch` was
    // correct only because `main.tsx` had patched the global one first.
    const patched = globalThis.fetch;
    expect(patched).not.toBe(original);
    expect(await boundedFetch("/api/audiobooks").then((res) => res.status)).toBe(200);
  });

  it("reports the server as unreachable when a request cannot be answered", async () => {
    // A phone that lost the server used to keep showing the shelf it had
    // loaded, with buttons that looked alive and silently did nothing -- the
    // unreachable report exists so the app can re-probe and go honestly
    // offline. Every request the app makes passes through here, so the
    // report lives here now that the global patch is gone.
    globalThis.fetch = (() => Promise.reject(new TypeError("Failed to fetch"))) as typeof fetch;
    let reported = 0;
    const stop = onServerUnreachable(() => {
      reported += 1;
    });

    try {
      await expect(boundedFetch("/api/audiobooks")).rejects.toThrow();
      expect(reported).toBe(1);
    } finally {
      stop();
    }
  });

  it("does not report the server as unreachable when it answered with an error", async () => {
    // A 500 is the server talking. It is a different problem with a different
    // fix, and the app must not go offline because of it.
    globalThis.fetch = (() =>
      Promise.resolve(new Response("{}", { status: 500 }))) as typeof fetch;
    let reported = 0;
    const stop = onServerUnreachable(() => {
      reported += 1;
    });

    try {
      await boundedFetch("/api/audiobooks");
      expect(reported).toBe(0);
    } finally {
      stop();
    }
  });
});
