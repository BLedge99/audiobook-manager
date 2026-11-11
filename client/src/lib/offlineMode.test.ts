import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isOfflineMode, setOfflineMode } from "./offlineMode";
import { boundedFetch } from "./api";

vi.mock("../local/privateCache", () => ({ lockOfflineCache: vi.fn() }));

/**
 * The offline-mode flag (spec 37, step 4.6).
 *
 * It used to live in three homes at once: the App's state plus its `localStorage`
 * write, and the api module's copy the request interface read. Three writes,
 * three readers, one fact. Now one module owns it.
 */
describe("the offline mode flag", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setOfflineMode(false);
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("is one value, readable from anywhere", () => {
    expect(isOfflineMode()).toBe(false);
    setOfflineMode(true);
    expect(isOfflineMode()).toBe(true);
    setOfflineMode(false);
    expect(isOfflineMode()).toBe(false);
  });

  it("survives a reload", async () => {
    setOfflineMode(true);
    expect(window.localStorage.getItem("offlineMode")).toBe("true");
    vi.resetModules();
    const fresh = await import("./offlineMode");
    expect(fresh.isOfflineMode()).toBe(true);
    vi.resetModules();
  });

  it("is what the request interface reads", async () => {
    setOfflineMode(true);
    await expect(boundedFetch("/api/auth/accounts")).rejects.toThrow("The app is in offline mode.");

    setOfflineMode(false);
    const fetchMock = vi.fn(() => Promise.resolve(new Response("{}", { status: 200 })));
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;
    try {
      await expect(boundedFetch("/api/auth/accounts")).resolves.toBeInstanceOf(Response);
      expect(fetchMock).toHaveBeenCalledOnce();
    } finally {
      globalThis.fetch = original;
    }
  });
});
