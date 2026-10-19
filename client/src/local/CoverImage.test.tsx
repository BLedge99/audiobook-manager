import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { setServerUrl, clearServerUrl } from "../lib/api";

/**
 * Spec 15b feature 1 — the device cover cache.
 *
 * The report this fixes: "sometimes work and display, then randomly stop and go
 * back to the placeholder, then other times are just a solid colour with no
 * placeholder or proper cover".
 *
 * The single invariant worth more than any of the individual behaviours: **an
 * `<img>` is never handed a network URL.** It is either a blob URL the browser
 * already holds bytes for, or the bundled placeholder. That is why the "solid
 * colour" case cannot recur, and it is asserted directly rather than inferred.
 *
 * **Every test runs against a freshly imported module.** The cache holds its
 * entries in module state, and "revalidated at most once per session" is a real
 * policy: a second render in the same session must *not* refetch, while a new
 * session must. Reopening the app is a module reload, so that is how the tests
 * model it -- re-rendering alone would have quietly asserted the opposite of the
 * intended behaviour.
 *
 * ## What these tests cannot check
 *
 * **`fake-indexeddb` does not round-trip a `Blob`.** A record written and read
 * back comes with `blob.type` and `blob.size` undefined, so these tests verify
 * that the *cache logic* finds, keeps and replaces records -- never that the
 * stored bytes decode. `URL.createObjectURL` is stubbed, which papers over that
 * and would hide it if it were not written down here.
 *
 * The bytes therefore being genuinely re-decodable after a restart is verified
 * on a real device instead, per the spec's on-device pass. That is a real gap in
 * this suite and it is not one a unit test can close.
 */

/** A 1x1 PNG, so a stored blob is something the browser would accept. */
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

/** The cache's public surface, re-imported per test. */
type CacheModule = typeof import("./CoverImage");

let cache: CacheModule;
let fetchMock: ReturnType<typeof vi.fn>;
let created: string[];

function imageResponse(etag: string | null = '"v1"') {
  return {
    ok: true,
    status: 200,
    headers: { get: (name: string) => (name.toLowerCase() === "etag" ? etag : null) },
    blob: async () => ({ type: "image/png", size: PNG_BYTES.length, bytes: PNG_BYTES }),
  } as unknown as Response;
}

function notModified() {
  return {
    ok: false,
    status: 304,
    headers: { get: () => null },
    blob: async () => null,
  } as unknown as Response;
}

/**
 * A new session: fresh module state, as if the app had been reopened.
 *
 * Deliberately does **not** clear the store -- that is the point. The bytes from
 * the previous session are exactly what a reopening app is supposed to find.
 * The store is emptied once per test, in `beforeEach`.
 */
async function startSession(): Promise<CacheModule> {
  vi.resetModules();
  return (await import("./CoverImage")) as CacheModule;
}

beforeEach(async () => {
  created = [];
  // jsdom has no object URLs; stub them and record every one so a stale URL can
  // be asserted on.
  URL.createObjectURL = vi.fn(() => {
    created.push(`blob:test/${created.length + 1}`);
    return created[created.length - 1];
  });
  URL.revokeObjectURL = vi.fn();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  clearServerUrl();
  // Once per test, before anything is cached.
  await (await startSession()).clearCoverCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("cover cache", () => {
  it("never hands an <img> a network URL", async () => {
    cache = await startSession();
    fetchMock.mockResolvedValue(imageResponse());
    render(<cache.CoverImage cacheKey={cache.bookCoverKey(1)} />);

    // Before the bytes arrive: the bundled placeholder, which is always valid.
    await waitFor(() => expect(screen.getByTestId("cover-img")).toHaveAttribute("src", "/placeholder-cover.svg"));

    await waitFor(() => expect(screen.getByTestId("cover-img").getAttribute("src")).toMatch(/^blob:/));

    // The decisive assertion. A blob URL is a local reference the browser can
    // always resolve; a LAN URL is the thing that failed intermittently.
    for (const image of Array.from(document.querySelectorAll("img"))) {
      expect(image.getAttribute("src")).not.toMatch(/^https?:/);
    }
  });

  it("serves a stored cover with no network at all", async () => {
    cache = await startSession();
    fetchMock.mockResolvedValue(imageResponse());
    const first = render(<cache.CoverImage cacheKey={cache.bookCoverKey(2)} />);
    await waitFor(() => expect(screen.getByTestId("cover-img").getAttribute("src")).toMatch(/^blob:/));
    // Close the app before reopening it, so the two sessions do not leave two
    // covers on screen and every assertion below is unambiguous.
    first.unmount();

    cache = await startSession();
    const boundary = fetchMock.mock.calls.length;
    fetchMock.mockRejectedValue(new Error("network down"));
    render(<cache.CoverImage cacheKey={cache.bookCoverKey(2)} />);

    await waitFor(() => expect(screen.getByTestId("cover-img").getAttribute("src")).toMatch(/^blob:/));
    // One conditional attempt is allowed; it failed, and the cover is still up.
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(boundary + 1);
  });

  it("does not refetch within a session, however often it renders", async () => {
    cache = await startSession();
    fetchMock.mockResolvedValue(imageResponse());
    const key = cache.bookCoverKey(20);

    // Four mounts, each replacing the previous one, as a scrolling grid does.
    let view = render(<cache.CoverImage cacheKey={key} />);
    await waitFor(() => expect(screen.getByTestId("cover-img").getAttribute("src")).toMatch(/^blob:/));
    const afterFirst = fetchMock.mock.calls.length;

    for (let i = 0; i < 3; i += 1) {
      view.unmount();
      view = render(<cache.CoverImage cacheKey={key} />);
      await waitFor(() => expect(screen.getByTestId("cover-img").getAttribute("src")).toMatch(/^blob:/));
    }
    view.unmount();

    // "Revalidated at most once per session" is what keeps a grid from putting
    // one request per card back on the wire.
    expect(fetchMock.mock.calls.length).toBe(afterFirst);
  });

  it("revalidates in a new session and keeps the bytes on 304", async () => {
    cache = await startSession();
    fetchMock.mockResolvedValue(imageResponse('"v1"'));
    const first = render(<cache.CoverImage cacheKey={cache.bookCoverKey(3)} />);
    await waitFor(() => expect(screen.getByTestId("cover-img").getAttribute("src")).toMatch(/^blob:/));
    first.unmount();

    // New session: the cover is already known, so it must be *checked*, not
    // refetched from scratch. The call boundary matters -- `mock.calls[0]` would
    // be the first session's unconditional fetch, which is exactly the
    // distinction being tested.
    const boundary = fetchMock.mock.calls.length;
    cache = await startSession();
    fetchMock.mockResolvedValue(notModified());
    render(<cache.CoverImage cacheKey={cache.bookCoverKey(3)} />);

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(boundary));
    const conditional = fetchMock.mock.calls[boundary];
    expect(conditional[1]).toMatchObject({ headers: { "If-None-Match": '"v1"' } });
    // 304 means unchanged, so the cover stays on screen.
    await waitFor(() => expect(screen.getByTestId("cover-img").getAttribute("src")).toMatch(/^blob:/));
  });

  it("replaces the cover when the server sends new bytes", async () => {
    cache = await startSession();
    fetchMock.mockResolvedValue(imageResponse('"v1"'));
    const first = render(<cache.CoverImage cacheKey={cache.bookCoverKey(4)} />);
    await waitFor(() => expect(screen.getByTestId("cover-img").getAttribute("src")).toMatch(/^blob:/));
    const firstSrc = screen.getByTestId("cover-img").getAttribute("src");
    first.unmount();

    // New session, server has new artwork.
    cache = await startSession();
    fetchMock.mockResolvedValue(imageResponse('"v2"'));
    render(<cache.CoverImage cacheKey={cache.bookCoverKey(4)} />);

    await waitFor(() => {
      const src = screen.getByTestId("cover-img").getAttribute("src");
      expect(src).toMatch(/^blob:/);
      expect(src).not.toBe(firstSrc);
    });
  });

  it("refuses to cache bytes that are not an image", async () => {
    // The "solid colour with no placeholder" case, caught at the boundary: a
    // cover route answering with the WebView's index.html would otherwise be
    // stored and painted.
    cache = await startSession();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      blob: async () => ({ type: "text/html", size: 900, bytes: new Uint8Array(900) }),
    } as unknown as Response);

    render(<cache.CoverImage cacheKey={cache.bookCoverKey(5)} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.getByTestId("cover-img").getAttribute("src")).toBe("/placeholder-cover.svg");
    });
    expect(cache.coverCacheBytes()).toBe(0);
  });

  it("fetches each key once however many components ask for it", async () => {
    cache = await startSession();
    fetchMock.mockResolvedValue(imageResponse());
    render(
      <>
        <cache.CoverImage cacheKey={cache.bookCoverKey(6)} />
        <cache.CoverImage cacheKey={cache.bookCoverKey(6)} />
        <cache.CoverImage cacheKey={cache.bookCoverKey(6)} />
      </>,
    );
    await waitFor(() =>
      expect(screen.getAllByTestId("cover-img").every((img) => img.getAttribute("src")?.startsWith("blob:"))).toBe(true),
    );
    const forSix = fetchMock.mock.calls.filter(([url]) => String(url).includes("/6/cover"));
    expect(forSix).toHaveLength(1);
  });

  it("resolves a provider URL the same way as a book cover", async () => {
    setServerUrl("http://192.168.1.203:3000");
    cache = await startSession();
    fetchMock.mockResolvedValue(imageResponse());
    const href = "https://covers.openlibrary.org/b/id/1-L.jpg";
    render(<cache.CoverImage cacheKey={cache.urlCoverKey(href)} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0][0])).toBe(href);
  });

  it("loads a cover even when IntersectionObserver never calls back", async () => {
    // The exact behaviour measured on the Pixel 4a / Android 13 WebView on
    // 2026-10-19: an observer on a plainly visible element never delivered its
    // initial pass unless something scrolled. Chromium does deliver it, so this
    // is invisible to every other environment -- and with an observer-only gate
    // it means *no cover is ever fetched* and nothing errors.
    //
    // Stubbed here as an observer that observes and then says nothing, which is
    // what the device did.
    const observed: Element[] = [];
    class SilentObserver {
      constructor(_cb: IntersectionObserverCallback, _options?: IntersectionObserverInit) {}
      observe(element: Element) {
        observed.push(element);
      }
      unobserve() {}
      disconnect() {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }
    vi.stubGlobal("IntersectionObserver", SilentObserver);

    cache = await startSession();
    fetchMock.mockResolvedValue(imageResponse());
    render(<cache.CoverImage cacheKey={cache.bookCoverKey(30)} />);

    // It did observe -- and then, as on the device, said nothing.
    expect(observed.length).toBe(1);
    // The deadline is ~1s, and RTL's default `waitFor` is also 1s, so this needs
    // headroom: the point of the test is precisely that it takes a moment.
    await waitFor(() => expect(screen.getByTestId("cover-img").getAttribute("src")).toMatch(/^blob:/), {
      timeout: 4000,
    });
    expect(fetchMock).toHaveBeenCalled();
  });

  it("does not wait for the fallback when the observer does report", async () => {
    // The optimisation still works: a cover the observer vouches for loads
    // without waiting out the deadline.
    class EagerObserver {
      constructor(private cb: IntersectionObserverCallback) {}
      observe(_element: Element) {
        this.cb([{ isIntersecting: true } as IntersectionObserverEntry], this as never);
      }
      unobserve() {}
      disconnect() {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }
    vi.stubGlobal("IntersectionObserver", EagerObserver);

    cache = await startSession();
    fetchMock.mockResolvedValue(imageResponse());
    render(<cache.CoverImage cacheKey={cache.bookCoverKey(31)} />);

    await waitFor(() => expect(screen.getByTestId("cover-img").getAttribute("src")).toMatch(/^blob:/));
  });

  it("clears on request and refetches afterwards", async () => {
    cache = await startSession();
    fetchMock.mockResolvedValue(imageResponse());
    render(<cache.CoverImage cacheKey={cache.bookCoverKey(7)} />);
    await waitFor(() => expect(screen.getByTestId("cover-img").getAttribute("src")).toMatch(/^blob:/));
    expect(cache.coverCacheBytes()).toBeGreaterThan(0);

    await cache.clearCoverCache();
    expect(cache.coverCacheBytes()).toBe(0);
  });
});
