import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installApiBaseUrl, resolveApiRequest, setServerUrl } from "./api";

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
    setServerUrl("http://192.168.1.203:3000");
    expect(resolveApiRequest("/api/audiobooks")).toBe("http://192.168.1.203:3000/api/audiobooks");
  });

  it("leaves the path alone when no server is configured", () => {
    // Dev server and PWA behaviour must be byte-identical to before spec 26.
    expect(resolveApiRequest("/api/audiobooks")).toBe("/api/audiobooks");
  });

  it("never rewrites an absolute http URL", () => {
    // The dangerous case: a naive wrapper turns this into
    // "<server>http://<server>/api/x" and every call 404s.
    setServerUrl("http://192.168.1.203:3000");
    const url = "http://192.168.1.203:3000/api/audiobooks";
    expect(resolveApiRequest(url)).toBe(url);
  });

  it("never rewrites a capacitor-file URL for local audio", () => {
    // A downloaded track's playable URL is not an API call. Prefixing it would
    // point <audio> at the server and break offline playback entirely.
    setServerUrl("http://192.168.1.203:3000");
    const url = "capacitor-file://_capacitor_file_/books%2F7%2F70.mp3";
    expect(resolveApiRequest(url)).toBe(url);
  });

  it("leaves blob and data URLs alone", () => {
    setServerUrl("http://192.168.1.203:3000");
    expect(resolveApiRequest("blob:capacitor://localhost/abc")).toBe("blob:capacitor://localhost/abc");
    expect(resolveApiRequest("data:audio/mp3;base64,AA")).toBe("data:audio/mp3;base64,AA");
  });

  it("leaves a protocol-relative URL alone", () => {
    setServerUrl("http://192.168.1.203:3000");
    expect(resolveApiRequest("//example.com/x")).toBe("//example.com/x");
  });

  it("resolves a URL object", () => {
    setServerUrl("http://192.168.1.203:3000");
    const url = new URL("http://192.168.1.203:3000/api/audiobooks");
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
      setServerUrl("http://192.168.1.203:3000");
      installApiBaseUrl();
      await fetch("/api/audiobooks");
      expect(calls[0]).toBe("http://192.168.1.203:3000/api/audiobooks");
    } finally {
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