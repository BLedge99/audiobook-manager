import { useCallback, useEffect, useRef, useState } from "react";
import type { Audiobook, LibraryRoot } from "./types";
import { boundedFetch, sessionHeaders } from "./lib/api";
import { responseErrorText } from "./lib/apiError";
import { copy } from "./copy";

/**
 * Library state, spec 15b feature 4.
 *
 * ## The bug this file is shaped around
 *
 * `loading` used to mean "refetching", so a refresh cleared the shelf and
 * rendered "Loading library..." for exactly as long as the request took. On a
 * waking phone over a home LAN that is close to a minute, and it looks like the
 * app has lost the library. Three separate defects shared that one cause:
 *
 *  - a refetch blanked the grid,
 *  - nothing refetched after a profile was picked, so progress was missing on
 *    arrival (LIMITATIONS 1.7),
 *  - five different triggers could stack requests on top of each other.
 *
 * So there are now two states with two meanings: `loading` is true only while
 * there is nothing to show, and `refreshing` is true whenever a request is in
 * flight. The grid keeps rendering whatever it has.
 */

type Conditional<T> = { changed: false } | { changed: true; data: T; etag: string | null };

/**
 * A conditional GET: sends `If-None-Match`, and treats 304 as "nothing changed".
 *
 * `response.ok` is false for 304 -- `ok` only covers 2xx -- so a 304 has to be
 * handled before the error branch, or an unchanged library looks like a failed
 * one.
 */
async function conditionalRequest<T>(url: string, etag: string | null): Promise<Conditional<T>> {
  const headers: Record<string, string> = { ...sessionHeaders() };
  if (etag) headers["If-None-Match"] = etag;

  // Bounded, because a request to an unreachable host can hang rather than
  // fail -- and a library refresh that never settles leaves "Refreshing…"
  // spinning for good.
  const response = await boundedFetch(url, { headers });
  if (response.status === 304) return { changed: false };
  if (!response.ok) {
    throw new Error(await responseErrorText(response));
  }
  return { changed: true, data: (await response.json()) as T, etag: response.headers.get("etag") };
}

async function writeRequest<T>(url: string, method: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { ...sessionHeaders() };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await boundedFetch(url, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers,
  });
  if (!response.ok) {
    throw new Error(await responseErrorText(response));
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export function useLibrary() {
  const [audiobooks, setAudiobooks] = useState<Audiobook[]>([]);
  const [roots, setRoots] = useState<LibraryRoot[]>([]);
  const [loading, setLoading] = useState(true);
  /**
   * A request is in flight. Separate from `loading` because the grid must keep
   * showing what it has while this is true.
   */
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();

  /**
   * Spec 27: every book the server has, with a flag for the ones this
   * profile holds.
   *
   * Fetched only when the Server library tab is opened. It is a second copy of
   * the library, and the tab is the only thing that needs it.
   */
  const [serverLibrary, setServerLibrary] = useState<Audiobook[]>([]);
  const [serverLibraryLoading, setServerLibraryLoading] = useState(false);
  const [serverLibraryError, setServerLibraryError] = useState<string>();

  /**
   * The ETag of the last body we actually stored.
   *
   * Refs, not state: this is request bookkeeping, and putting it in state would
   * mean a render for something no UI reads.
   */
  const booksEtagRef = useRef<string | null>(null);
  const rootsEtagRef = useRef<string | null>(null);

  /**
   * The request currently in flight, so concurrent callers share it.
   *
   * Five triggers fire refetches -- the player's final save, window focus,
   * `visibilitychange`, the scan poller every 1.5s, and the refresh button -- and
   * they overlap constantly. Without this, tapping refresh while a scan is
   * polling puts five identical full-library requests on the wire at once, which
   * is the slow network making itself slower.
   */
  const inFlightRef = useRef<Promise<void> | null>(null);

  const refresh = useCallback((): Promise<void> => {
    if (inFlightRef.current) return inFlightRef.current;

    const run = (async () => {
      setRefreshing(true);
      try {
        // Both endpoints are conditional and independent: `library-roots`
        // carries scan state, which changes during a scan even when no book
        // does, so folding it into one payload would invalidate the library's
        // tag for a reason the client cannot see.
        const [books, libraryRoots] = await Promise.all([
          conditionalRequest<Audiobook[]>("/api/audiobooks", booksEtagRef.current),
          conditionalRequest<LibraryRoot[]>("/api/library-roots", rootsEtagRef.current),
        ]);
        // A 304 leaves state alone -- which is the whole point. An error does
        // too: a failed refresh must not empty a library that already loaded.
        if (books.changed) {
          setAudiobooks(books.data);
          booksEtagRef.current = books.etag;
        }
        if (libraryRoots.changed) {
          setRoots(libraryRoots.data);
          rootsEtagRef.current = libraryRoots.etag;
        }
        setError(undefined);
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : copy.errors.loadLibrary);
      } finally {
        setRefreshing(false);
        // Only a fetch that has never produced rows may show "loading". After
        // that the shelf is never blanked, so this is a one-way latch.
        setLoading(false);
        inFlightRef.current = null;
      }
    })();

    inFlightRef.current = run;
    return run;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addRoot = async (path: string, label: string) => {
    await writeRequest<LibraryRoot>("/api/library-roots", "POST", { path, label });
    await refresh();
  };

  const removeRoot = async (id: number) => {
    await writeRequest<void>(`/api/library-roots/${id}`, "DELETE");
    await refresh();
  };

  const scan = async (rootId?: number) => {
    await writeRequest("/api/scan", "POST", rootId ? { rootId } : {});
    await refresh();
  };

  /**
   * Spec 27: load the whole server library.
   *
   * Not conditional. The library listing already is, and this is a different
   * question -- "what does the server have?" -- so the two never share a tag.
   */
  const loadServerLibrary = useCallback(async () => {
    setServerLibraryLoading(true);
    try {
      setServerLibrary(await writeRequest<Audiobook[]>("/api/server-library", "GET"));
      setServerLibraryError(undefined);
    } catch (requestError) {
      setServerLibraryError(
        requestError instanceof Error ? requestError.message : copy.errors.loadAllBooks,
      );
    } finally {
      setServerLibraryLoading(false);
    }
  }, []);

  /**
   * Spec 27: add a book to this profile's library.
   *
   * The flag flips locally first so the button responds to the tap, and the
   * lists are refetched afterwards to reconcile. The refetch is what makes it
   * correct: the library listing is a different payload, and a book that has
   * just joined the profile is not in it until the server says so.
   */
  const addToLibrary = useCallback(
    async (bookId: number) => {
      setServerLibrary((current) =>
        current.map((book) => (book.id === bookId ? { ...book, inLibrary: true } : book)),
      );
      await writeRequest(`/api/audiobooks/${bookId}/library`, "POST");
      await refresh();
      await loadServerLibrary();
    },
    [refresh, loadServerLibrary],
  );

  /**
   * Spec 27: remove a book from this profile's library.
   *
   * The book stays on the server. Only this profile stops seeing it.
   */
  const removeFromLibrary = useCallback(
    async (bookId: number) => {
      setServerLibrary((current) =>
        current.map((book) => (book.id === bookId ? { ...book, inLibrary: false } : book)),
      );
      await writeRequest(`/api/audiobooks/${bookId}/library`, "DELETE");
      await refresh();
      await loadServerLibrary();
    },
    [refresh, loadServerLibrary],
  );

  useEffect(() => {
    if (!roots.some((root) => root.scanState?.status === "scanning")) return;
    const timer = window.setInterval(() => {
      void refresh();
    }, 1500);
    return () => window.clearInterval(timer);
  }, [roots, refresh]);

  return {
    audiobooks,
    roots,
    loading,
    refreshing,
    error,
    refresh,
    addRoot,
    removeRoot,
    scan,
    serverLibrary,
    serverLibraryLoading,
    serverLibraryError,
    loadServerLibrary,
    addToLibrary,
    removeFromLibrary,
  };
}
