/**
 * Regression test for the Discover freeze.
 *
 * The report: "whenever you go to discover, and load some books, the page
 * freezes and crashes."
 *
 * The loop: `peek()` (the `useSyncExternalStore` snapshot, called on every
 * render) used to call `ensure()` synchronously. When a provider cover could
 * not be fetched — Open Library unreachable, DNS down, or the device offline —
 * the failure path cleared `entry.fetching` and called `notify()`. The next
 * getSnapshot re-fired `ensure()` for every failing cover, which fetched,
 * failed, notified again: an unbounded fetch/render cycle that pinned the
 * main thread and eventually took the tab down.
 *
 * Discover, ExternalBooks and the review queue are the only surfaces using
 * provider URLs, which is why the crash followed cover URL failures and not
 * ordinary LAN-served book covers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { clearServerUrl } from "../lib/api";

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
  0xae, 0x42, 0x60, 0x82,
]);

type CacheModule = typeof import("./CoverImage");
let cache: CacheModule;
let fetchMock: ReturnType<typeof vi.fn>;

const PROVIDER_COVERS = [
  "https://covers.openlibrary.org/b/id/1-M.jpg",
  "https://covers.openlibrary.org/b/id/2-M.jpg",
  "https://covers.openlibrary.org/b/id/3-M.jpg",
  "https://covers.openlibrary.org/b/id/4-M.jpg",
  "https://covers.openlibrary.org/b/id/5-M.jpg",
];

async function startSession(): Promise<CacheModule> {
  vi.resetModules();
  return (await import("./CoverImage")) as CacheModule;
}

beforeEach(async () => {
  URL.createObjectURL = vi.fn(() => "blob:test/1");
  URL.revokeObjectURL = vi.fn();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  clearServerUrl();
  await (await startSession()).clearCoverCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("provider cover failure storm", () => {
  it("does not re-fire fetches in an unbounded loop when covers fail", async () => {
    cache = await startSession();
    // Fast, hard failure — the LAN is offline / DNS does not resolve.
    fetchMock.mockRejectedValue(new Error("covers unreachable"));

    for (const url of PROVIDER_COVERS) {
      render(<cache.CoverImage cacheKey={cache.urlCoverKey(url)} />);
    }

    // Let the failing fetches settle and every notification flush through.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled(), { timeout: 2000 });
    await new Promise((resolve) => setTimeout(resolve, 200));

    // One attempt per cover, at most one revalidate each. The loop this
    // guards against made this number grow without bound while the tab
    // ground to a halt.
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(
      PROVIDER_COVERS.length * 2,
    );
  });
});
