import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useLibrary } from "./useLibrary";
import type { Audiobook } from "./types";

/**
 * Spec 15b feature 4 — a refresh must never blank the library.
 *
 * The bug was a single state conflation: `loading` meant "refetching", so the
 * grid was replaced by "Loading library..." for the whole round trip. On a
 * waking phone over a home LAN that reads as the app having lost the library.
 *
 * These tests pin the three behaviours that fix it, plus the two the fix would
 * be worthless without: requests must coalesce, and a 304 or a failure must
 * leave the shelf exactly as it was.
 */

/** Minimal Response stand-in. `headers.get` is all the hook reads from it. */
function fakeResponse(body: unknown, init: { status?: number; etag?: string | null } = {}) {
  const status = init.status ?? 200;
  const etag = init.etag === undefined ? `"etag-${Math.random()}"` : init.etag;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === "etag" ? etag : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function book(id: number, title: string): Audiobook {
  return {
    id,
    title,
    author: "Someone",
    fileFormat: "mp3",
    duration: 3600,
    tracks: [],
    contributors: [],
    genres: [],
    customTags: [],
  } as unknown as Audiobook;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Resolve both library endpoints with the given books. */
function respondWith(books: Audiobook[]) {
  fetchMock.mockImplementation(async (url: string) =>
    url.includes("library-roots") ? fakeResponse([]) : fakeResponse(books),
  );
}

/** Mount and wait for the first load to settle. */
async function mountWith(books: Audiobook[]) {
  respondWith(books);
  const view = renderHook(() => useLibrary());
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  return view;
}

describe("useLibrary", () => {
  /**
   * Spec 27 — the server library and the membership actions.
   *
   * The property worth protecting is that the flag flips **immediately** on a
   * tap, and that the lists are refetched afterwards so they end up true
   * rather than merely fast. A UI that waits for the round trip before it
   * responds feels broken on a home LAN; a UI that never refetches drifts.
   */
  describe("the server library", () => {
    it("is not fetched until it is asked for", async () => {
      const { result } = await mountWith([book(1, "One")]);
      const urls = fetchMock.mock.calls.map(([url]) => String(url));
      expect(urls.some((url) => url.includes("/api/server-library"))).toBe(false);

      await act(async () => {
        await result.current.loadServerLibrary();
      });
      const after = fetchMock.mock.calls.map(([url]) => String(url));
      expect(after.some((url) => url.includes("/api/server-library"))).toBe(true);
    });

    it("marks the flag as soon as a book is added, before the request lands", async () => {
      const { result } = await mountWith([book(1, "One")]);
      // The server library says the book is not in the profile yet.
      fetchMock.mockImplementation(async (url: string) =>
        url.includes("server-library")
          ? fakeResponse([{ ...book(1, "One"), inLibrary: false }])
          : url.includes("library-roots")
            ? fakeResponse([])
            : fakeResponse([book(1, "One")]),
      );
      await act(async () => {
        await result.current.loadServerLibrary();
      });
      expect(result.current.serverLibrary[0].inLibrary).toBe(false);

      // The POST never answers, so the state can only be the optimistic one.
      fetchMock.mockImplementation(async (url: string) => {
        if (String(url).endsWith("/1/library")) {
          return new Promise(() => undefined) as unknown as Response;
        }
        return url.includes("server-library")
          ? fakeResponse([{ ...book(1, "One"), inLibrary: false }])
          : url.includes("library-roots")
            ? fakeResponse([])
            : fakeResponse([book(1, "One")]);
      });

      act(() => {
        void result.current.addToLibrary(1);
      });

      // The tap has already been answered, without waiting for the round trip.
      await waitFor(() => expect(result.current.serverLibrary[0].inLibrary).toBe(true));
    });

    it("removes a book with a DELETE", async () => {
      const { result } = await mountWith([book(1, "One")]);
      fetchMock.mockImplementation(async (url: string) =>
        url.includes("server-library")
          ? fakeResponse([])
          : url.includes("library-roots")
            ? fakeResponse([])
            : fakeResponse([]),
      );

      await act(async () => {
        await result.current.removeFromLibrary(1);
      });
      const deleted = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/1/library"));
      expect(deleted?.[1]?.method).toBe("DELETE");
    });

    it("puts the book back when the removal does not reach the server", async () => {
      // The household's report: books were taken out of the library and the
      // library still had them. The cause was not the server -- the request
      // never left the phone -- and the visible symptom was the optimistic
      // change standing there on its own, with the library never agreeing.
      //
      // The shelf and the library are one fact seen twice. When the request
      // fails, the local flag goes back, so the two cannot disagree.
      const { result } = await mountWith([book(1, "One")]);
      fetchMock.mockImplementation(async (url: string) => {
        if (String(url).includes("/1/library")) {
          throw new TypeError("Failed to fetch");
        }
        return url.includes("server-library")
          ? fakeResponse([{ ...book(1, "One"), inLibrary: true }])
          : url.includes("library-roots")
            ? fakeResponse([])
            : fakeResponse([book(1, "One")]);
      });
      await act(async () => {
        await result.current.loadServerLibrary();
      });
      expect(result.current.serverLibrary[0].inLibrary).toBe(true);

      await act(async () => {
        await expect(result.current.removeFromLibrary(1)).rejects.toThrow();
      });

      // Back where the server says it is: still in the library.
      expect(result.current.serverLibrary[0].inLibrary).toBe(true);
    });

    it("puts the book back when adding it does not reach the server", async () => {
      const { result } = await mountWith([book(1, "One")]);
      fetchMock.mockImplementation(async (url: string) => {
        if (String(url).includes("/1/library")) {
          throw new TypeError("Failed to fetch");
        }
        return url.includes("server-library")
          ? fakeResponse([{ ...book(1, "One"), inLibrary: false }])
          : url.includes("library-roots")
            ? fakeResponse([])
            : fakeResponse([book(1, "One")]);
      });
      await act(async () => {
        await result.current.loadServerLibrary();
      });
      expect(result.current.serverLibrary[0].inLibrary).toBe(false);

      await act(async () => {
        await expect(result.current.addToLibrary(1)).rejects.toThrow();
      });

      expect(result.current.serverLibrary[0].inLibrary).toBe(false);
    });
  });

  it("keeps the books on screen while a refresh is in flight", async () => {
    const { result } = await mountWith([book(1, "One"), book(2, "Two")]);
    expect(result.current.audiobooks).toHaveLength(2);

    // A refresh that never resolves is the worst case, and the one the user
    // reported: the round trip took the best part of a minute.
    let release: (() => void) | undefined;
    fetchMock.mockImplementation(
      (url: string) =>
        new Promise((resolve) => {
          if (url.includes("library-roots")) return resolve(fakeResponse([]));
          release = () => resolve(fakeResponse([book(1, "One"), book(2, "Two")]));
        }),
    );

    act(() => {
      void result.current.refresh();
    });

    await waitFor(() => expect(result.current.refreshing).toBe(true));
    // The whole point: rows, and no "loading" that would replace them.
    expect(result.current.audiobooks).toHaveLength(2);
    expect(result.current.loading).toBe(false);

    await act(async () => {
      release?.();
    });
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(result.current.audiobooks).toHaveLength(2);
  });

  it("collapses concurrent refreshes into one request per endpoint", async () => {
    respondWith([book(1, "One")]);
    const { result } = renderHook(() => useLibrary());

    // Five triggers overlap constantly in the real app: the player's final
    // save, window focus, visibilitychange, the scan poller and a manual tap.
    act(() => {
      void result.current.refresh();
      void result.current.refresh();
      void result.current.refresh();
      void result.current.refresh();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    const bookCalls = fetchMock.mock.calls.filter(([url]) => !String(url).includes("library-roots"));
    expect(bookCalls).toHaveLength(1);
    expect(result.current.audiobooks).toHaveLength(1);
  });

  it("sends the stored ETag and treats 304 as unchanged", async () => {
    const first = await mountWith([book(1, "One")]);

    fetchMock.mockImplementation(async (url: string, init: { headers?: Record<string, string> }) => {
      if (url.includes("library-roots")) return fakeResponse([]);
      // The server answers 304, which is *not* `ok` -- `ok` is 2xx only.
      if (init.headers?.["If-None-Match"]) return fakeResponse(null, { status: 304, etag: null });
      return fakeResponse([book(1, "One")]);
    });

    await act(async () => {
      await first.result.current.refresh();
    });

    const secondCall = fetchMock.mock.calls.find(([url, init]) => !String(url).includes("library-roots") && (init as { headers?: Record<string, string> })?.headers?.["If-None-Match"]);
    expect(secondCall).toBeTruthy();
    // Rows survive, and a 304 is not reported as a failure.
    expect(first.result.current.audiobooks).toHaveLength(1);
    expect(first.result.current.error).toBeUndefined();
    expect(first.result.current.refreshing).toBe(false);
  });

  it("keeps the books when a refresh fails", async () => {
    const { result } = await mountWith([book(1, "One")]);

    fetchMock.mockRejectedValueOnce(new Error("network down"));
    await act(async () => {
      await result.current.refresh();
    });

    // A failed refresh must not empty a library that already loaded -- that is
    // the same "nothing in library" symptom by a different route.
    expect(result.current.audiobooks).toHaveLength(1);
    expect(result.current.error).toBe("network down");
    expect(result.current.loading).toBe(false);
  });

  it("surfaces a failed first load without inventing rows", async () => {
    fetchMock.mockRejectedValue(new Error("server unreachable"));
    const { result } = renderHook(() => useLibrary());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.audiobooks).toHaveLength(0);
    expect(result.current.error).toBe("server unreachable");
  });

  it("says the server could not be reached, in words a person can act on", async () => {
    // The browser's own answer -- "Failed to fetch" -- is what the household
    // was shown, more than once, while the server was unreachable. It says
    // nothing about what to do, and it names neither of the two causes.
    const { result } = await mountWith([book(1, "One")]);
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.error).toBe(
      "Could not reach the server. Check the phone is on the home network, and that the server address in Settings is right.",
    );
  });

  it("reports refreshing for the very first load too", async () => {
    let release: (() => void) | undefined;
    fetchMock.mockImplementation(
      (url: string) =>
        new Promise((resolve) => {
          if (url.includes("library-roots")) return resolve(fakeResponse([]));
          release = () => resolve(fakeResponse([book(1, "One")]));
        }),
    );
    const { result } = renderHook(() => useLibrary());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.refreshing).toBe(true));

    await act(async () => {
      release?.();
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.refreshing).toBe(false);
  });
});
