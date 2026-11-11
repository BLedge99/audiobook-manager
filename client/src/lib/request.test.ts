import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copy } from "../copy";
import { fakeResponse, stubFetch, type FetchStub } from "../test/requests";
import { request, requestConditional, requestRaw } from "./request";
import { setActiveProfileId, setSessionToken } from "./api";
import { setOfflineMode } from "./offlineMode";

/**
 * The request interface.
 *
 * Every call the app makes to its own server goes through here, so the
 * guarantees below are the ones the whole app relies on. They used to be
 * spread across eight private `request` helpers and a global `window.fetch`
 * monkey-patch, which meant each call site inherited a slightly different
 * set -- and one of them (`ProfileSwitcher`) had neither a timeout nor an
 * error handler.
 *
 * The five guarantees:
 *
 *  1. **Bounded** -- a request to a host that never answers gives up.
 *  2. **Authenticated** -- the session cookie travels, or the session header
 *     is attached in the native shell.
 *  3. **Profile-scoped** -- `x-profile-id` says whose data is being asked for.
 *  4. **One error vocabulary** -- a failure throws the reviewed sentence, not
 *     the server's prose.
 *  5. **Offline-aware** -- in explicit offline mode the request refuses
 *     instead of hanging.
 */

/** Simulate the Capacitor bridge, which the client reads defensively. */
function setNativeShell(isNative: boolean) {
  (window as unknown as { Capacitor?: unknown }).Capacitor = {
    isNativePlatform: () => isNative,
  };
}

let stub: FetchStub | null = null;

beforeEach(() => {
  window.localStorage.clear();
  setActiveProfileId(null);
  setSessionToken(null);
  setOfflineMode(false);
  setNativeShell(false);
});

afterEach(() => {
  stub?.restore();
  stub = null;
  vi.unstubAllGlobals();
});

describe("request", () => {
  it("gives up on a server that never answers", async () => {
    // A fetch to an unreachable host does not always fail -- it hangs. A
    // request with no deadline leaves the spinner running for good, and the
    // reachability probe left the whole app on "Connecting..." with no way out.
    stub = stubFetch(() => new Promise<Response>(() => {}));

    await expect(request("/api/audiobooks", { timeoutMs: 20 })).rejects.toThrow();
  });

  it("asks for credentials so the session cookie travels", async () => {
    // The Android WebView is cross-origin from the server, so without this
    // the cookie never crosses and every call 401s.
    stub = stubFetch(() => fakeResponse([]));

    await request("/api/audiobooks");

    expect(stub.last()?.credentials).toBe("include");
  });

  it("sends the session header in the native shell", async () => {
    // The browser relies on the HttpOnly cookie; Android keeps its token in
    // memory and sends it as a header, because the WebView cannot rely on a
    // cross-site cookie.
    setNativeShell(true);
    setSessionToken("token-abc");
    stub = stubFetch(() => fakeResponse([]));

    await request("/api/audiobooks");

    expect(stub.last()?.headers["x-house-session"]).toBe("token-abc");
  });

  it("sends the profile header", async () => {
    setActiveProfileId(7);
    stub = stubFetch(() => fakeResponse([]));

    await request("/api/audiobooks");

    expect(stub.last()?.headers["x-profile-id"]).toBe("7");
  });

  it("sends the caller's own headers alongside the standard ones", async () => {
    setActiveProfileId(7);
    stub = stubFetch(() => fakeResponse([]));

    await request("/api/audiobooks", { headers: { "If-None-Match": '"etag"' } });

    expect(stub.last()?.headers["if-none-match"]).toBe('"etag"');
    expect(stub.last()?.headers["x-profile-id"]).toBe("7");
  });

  it("throws the catalogued sentence for a failure code", async () => {
    // ADR 015: the server answers with a stable code and the client owns
    // every word. A sentence the server wrote is invisible to the copy check.
    stub = stubFetch(() => fakeResponse({ code: "audiobook_not_found" }, { status: 404 }));

    await expect(request("/api/audiobooks/9")).rejects.toThrow(copy.apiErrors.audiobookNotFound);
  });

  it("falls back to the generic sentence when the error is not JSON", async () => {
    // A proxy's HTML error page must never reach a listener.
    stub = stubFetch(
      () =>
        ({ ok: false, status: 502, text: async () => "<html>oops</html>" }) as unknown as Response,
    );

    await expect(request("/api/audiobooks")).rejects.toThrow(
      "The server did not answer as expected (HTTP 502). Try again in a moment.",
    );
  });

  it("falls back to the generic sentence for a code it does not know", async () => {
    // An older client must survive a newer server adding a code.
    stub = stubFetch(() => fakeResponse({ code: "a_code_from_a_newer_server" }, { status: 409 }));

    await expect(request("/api/audiobooks")).rejects.toThrow(
      "The server did not answer as expected (HTTP 409). Try again in a moment.",
    );
  });

  it("refuses in explicit offline mode", async () => {
    setOfflineMode(true);
    stub = stubFetch(() => fakeResponse([]));

    await expect(request("/api/audiobooks")).rejects.toThrow();
    expect(stub.calls).toHaveLength(0);
  });

  it("returns the parsed body", async () => {
    stub = stubFetch(() => fakeResponse([{ id: 1, title: "A book" }]));

    expect(await request("/api/audiobooks")).toEqual([{ id: 1, title: "A book" }]);
  });

  it("returns undefined for a 204", async () => {
    stub = stubFetch(() => fakeResponse(undefined, { status: 204 }));

    expect(await request("/api/audiobooks/1/library", { method: "DELETE" })).toBeUndefined();
  });

  it("sends a JSON body when one is given", async () => {
    stub = stubFetch(() => fakeResponse({}));

    await request("/api/audiobooks/1/progress", {
      method: "PUT",
      body: { position: 12 },
    });

    expect(stub.last()?.method).toBe("PUT");
    expect(stub.last()?.headers["content-type"]).toBe("application/json");
    expect(stub.last()?.body).toBe(JSON.stringify({ position: 12 }));
  });

  it("sends the body as a JSON object, not as a JSON string containing JSON", async () => {
    // The interface serialises the body itself, so a caller that passed an
    // already-stringified body would send it double-encoded -- the server
    // would read a string where it expects an object, and the write would
    // silently do nothing. `body` is typed `object` so that is a type error;
    // this test is the runtime half of the same guard.
    stub = stubFetch(() => fakeResponse({}));

    await request("/api/audiobooks/1/tags", { method: "PUT", body: { title: "A book" } });

    expect(JSON.parse(stub.last()?.body ?? "null")).toEqual({ title: "A book" });
  });

  it("sends no body and no content-type when none is given", async () => {
    stub = stubFetch(() => fakeResponse([]));

    await request("/api/audiobooks");

    expect(stub.last()?.body).toBeUndefined();
    expect(stub.last()?.headers["content-type"]).toBeUndefined();
  });

  it("passes an absolute URL through untouched", async () => {
    // The server-setup screens probe an address the listener just typed, which
    // is not the configured server. Resolving it against the configured base
    // would produce "http://server:3000http://server:3000/api/health".
    stub = stubFetch(() => fakeResponse({}));

    await request("http://other-server:3000/api/health");

    expect(stub.last()?.url).toBe("http://other-server:3000/api/health");
  });
});

describe("requestRaw", () => {
  it("hands back the response so the caller can read the headers", async () => {
    // The library listing needs the ETag, and the cover route needs the
    // stream. Those cannot go through the JSON path.
    stub = stubFetch(() => fakeResponse([], { etag: '"abc"' }));

    const response = await requestRaw("/api/audiobooks");

    expect(response.headers.get("etag")).toBe('"abc"');
  });

  it("does not throw on a failure -- the caller decides", async () => {
    // A conditional GET treats 304 as "nothing changed", not as an error.
    stub = stubFetch(() => fakeResponse(undefined, { status: 304 }));

    const response = await requestRaw("/api/audiobooks");

    expect(response.status).toBe(304);
  });
});

describe("requestConditional", () => {
  it("treats a 304 as nothing changed", async () => {
    // The shelf must not be blanked by a response that says "same as last
    // time". A refresh that changed nothing must send nothing.
    stub = stubFetch(() => fakeResponse(undefined, { status: 304 }));

    expect(await requestConditional("/api/audiobooks", { etag: '"abc"' })).toEqual({
      changed: false,
    });
  });

  it("returns the data and the new etag", async () => {
    stub = stubFetch(() => fakeResponse([{ id: 1 }], { etag: '"next"' }));

    expect(await requestConditional("/api/audiobooks", { etag: '"abc"' })).toEqual({
      changed: true,
      data: [{ id: 1 }],
      etag: '"next"',
    });
  });

  it("sends the etag it was given", async () => {
    stub = stubFetch(() => fakeResponse([]));

    await requestConditional("/api/audiobooks", { etag: '"abc"' });

    expect(stub.last()?.headers["if-none-match"]).toBe('"abc"');
  });

  it("sends no etag when it has none", async () => {
    stub = stubFetch(() => fakeResponse([]));

    await requestConditional("/api/audiobooks", {});

    expect(stub.last()?.headers["if-none-match"]).toBeUndefined();
  });

  it("throws the catalogued sentence on a failure", async () => {
    stub = stubFetch(() => fakeResponse({ code: "audiobook_not_found" }, { status: 404 }));

    await expect(requestConditional("/api/audiobooks/9", {})).rejects.toThrow(
      copy.apiErrors.audiobookNotFound,
    );
  });
});
