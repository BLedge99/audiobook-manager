import { describe, expect, it, vi } from "vitest";
import { fakeResponse, stubFetch } from "./requests";

/**
 * The shared request helpers.
 *
 * Three test files each wrote their own `fakeResponse` and their own
 * `vi.stubGlobal("fetch", ...)`, and they disagreed: one knew about ETags,
 * two did not, and none of them recorded what was actually requested. A test
 * that cannot see the request cannot assert on the request.
 *
 * These helpers are the interface. The helper itself is tested here, so a
 * broken helper fails loudly in one place rather than quietly in twenty.
 */

describe("fakeResponse", () => {
  it("reports ok for 2xx and not for 304", () => {
    // `response.ok` only covers 2xx, so a 304 has to be handled before the
    // error branch -- an unchanged library must not look like a failed one.
    expect(fakeResponse({}, { status: 200 }).ok).toBe(true);
    expect(fakeResponse({}, { status: 204 }).ok).toBe(true);
    expect(fakeResponse({}, { status: 304 }).ok).toBe(false);
    expect(fakeResponse({}, { status: 500 }).ok).toBe(false);
  });

  it("exposes an etag only when one was given", () => {
    expect(fakeResponse({}, { etag: '"abc"' }).headers.get("etag")).toBe('"abc"');
    expect(fakeResponse({}, { etag: null }).headers.get("etag")).toBeNull();
    // No etag at all is not the same as an explicit null: one means "this
    // response has no tag", the other means "do not ask".
    expect(fakeResponse({}).headers.get("etag")).toBeNull();
  });

  it("matches the header name case-insensitively", () => {
    // `headers.get` is case-insensitive in the real Fetch API, and the
    // library hook asks for "etag" while a server may send "ETag".
    expect(fakeResponse({}, { etag: '"abc"' }).headers.get("ETAG")).toBe('"abc"');
  });

  it("returns the body from json() and text()", async () => {
    const response = fakeResponse({ hello: "world" });
    expect(await response.json()).toEqual({ hello: "world" });
    expect(await response.text()).toBe(JSON.stringify({ hello: "world" }));
  });

  it("reads the body back consistently", async () => {
    // A Response body can only be read once in the real API. These fakes
    // answer every time, because a test that reads the body twice to assert
    // two things is not testing anything the app does.
    const response = fakeResponse([1, 2, 3]);
    expect(await response.json()).toEqual([1, 2, 3]);
    expect(await response.json()).toEqual([1, 2, 3]);
  });
});

describe("stubFetch", () => {
  it("answers with the handler's response", async () => {
    const stub = stubFetch(() => fakeResponse({ ok: true }));
    try {
      const response = await fetch("/api/audiobooks");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    } finally {
      stub.restore();
    }
  });

  it("records every request it saw, in order", async () => {
    const stub = stubFetch(() => fakeResponse([]));
    try {
      await fetch("/api/one");
      await fetch("/api/two", { method: "POST" });
      expect(stub.calls.map((call) => call.url)).toEqual(["/api/one", "/api/two"]);
      expect(stub.calls.map((call) => call.method)).toEqual(["GET", "POST"]);
    } finally {
      stub.restore();
    }
  });

  it("records the headers and the body the caller sent", async () => {
    const stub = stubFetch(() => fakeResponse({}));
    try {
      await fetch("/api/audiobooks", {
        method: "PUT",
        headers: { "x-profile-id": "7", "Content-Type": "application/json" },
        body: JSON.stringify({ position: 12 }),
      });
      const call = stub.last();
      expect(call?.headers["x-profile-id"]).toBe("7");
      expect(call?.headers["content-type"]).toBe("application/json");
      expect(call?.body).toBe(JSON.stringify({ position: 12 }));
    } finally {
      stub.restore();
    }
  });

  it("finds the requests that mention a fragment of the URL", async () => {
    const stub = stubFetch(() => fakeResponse([]));
    try {
      await fetch("/api/genres");
      await fetch("/api/tags");
      await fetch("/api/favourites/ids");
      expect(stub.to("favourites").map((call) => call.url)).toEqual(["/api/favourites/ids"]);
      expect(stub.to("/api/")).toHaveLength(3);
    } finally {
      stub.restore();
    }
  });

  it("puts the real fetch back when restored", () => {
    const original = globalThis.fetch;
    const stub = stubFetch(() => fakeResponse({}));
    expect(globalThis.fetch).not.toBe(original);
    stub.restore();
    expect(globalThis.fetch).toBe(original);
  });

  it("lets a handler reject, so a failed request can be tested", async () => {
    const stub = stubFetch(() => {
      throw new Error("network error");
    });
    try {
      await expect(fetch("/api/audiobooks")).rejects.toThrow("network error");
    } finally {
      stub.restore();
    }
  });

  it("can be restored twice without complaint", () => {
    const stub = stubFetch(() => fakeResponse({}));
    stub.restore();
    expect(() => stub.restore()).not.toThrow();
  });

  it("leaves the global fetch alone when the caller does not restore it", () => {
    // Vitest's `unstubAllGlobals` in `afterEach` is the backstop; the helper
    // must not fight it. This asserts the helper does not double-register.
    const original = globalThis.fetch;
    stubFetch(() => fakeResponse({}));
    expect(globalThis.fetch).not.toBe(original);
    vi.unstubAllGlobals();
    expect(globalThis.fetch).toBe(original);
  });
});
