import { beforeEach, describe, expect, it } from "vitest";
import { resolveApiRequest, setServerUrl } from "./api";
import { TEST_SERVER_URL } from "../test/constants";

/**
 * `/api/...` resolves against the configured server. This used to ride on a
 * global `window.fetch` patch; the request owns the same guarantee now, and
 * `resolveApiRequest` is the shared half of it (`boundedFetch` calls it too).
 */

describe("resolveApiRequest", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

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
