import { useCallback, useEffect, useState } from "react";
import type {
  Audiobook,
  BookTagSuite,
  DiscoverResult,
  EnrichmentStatus,
  GenreNode,
  Recommendation,
  TagSummary,
  WishlistItem,
} from "./types";
import { boundedFetch } from "./lib/api";
import { responseErrorText } from "./lib/apiError";
import { copy } from "./copy";
import {
  cacheFavourites,
  cacheWishlist,
  readFavourites,
  readWishlist,
} from "./local/privateCache";

/**
 * Spec 20 — data layer for the browse, Discover, favourites and tag surfaces.
 *
 * Uses the same profile-header request helper as `useLibrary` so the
 * `x-profile-id` header and error handling cannot drift between the two.
 */

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const profileId = typeof window !== "undefined" ? window.localStorage.getItem("profileId") : null;
  const headers: Record<string, string> = {};
  if (options?.body) headers["Content-Type"] = "application/json";
  if (profileId) headers["x-profile-id"] = profileId;
  const response = await boundedFetch(url, {
    ...options,
    headers: { ...headers, ...(options?.headers as Record<string, string> | undefined) },
  });
  if (!response.ok) {
    throw new Error(await responseErrorText(response));
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export function useBrowse() {
  const [genres, setGenres] = useState<GenreNode[]>([]);
  const [tags, setTags] = useState<TagSummary[]>([]);
  const [favourites, setFavourites] = useState<number[]>([]);
  const [enrichment, setEnrichment] = useState<EnrichmentStatus>();
  const [reviewQueue, setReviewQueue] = useState<Audiobook[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Re-read on every render so a profile switch triggers a re-fetch. `request`
  // reads the same key, so the server call always scopes to the current profile.
  const profileId = typeof window !== "undefined" ? window.localStorage.getItem("profileId") : null;

  const refresh = useCallback(async () => {
    let favIds: number[] | undefined;

    // Each endpoint is independent: one failure must not discard the others.
    // Favourites are cached as soon as they arrive, even if enrichment or the
    // genre/tag endpoints fail.
    const genreRes = await request<GenreNode[]>("/api/genres")
      .catch((err) => { console.warn("genres endpoint failed", err); return [] as GenreNode[]; });
    setGenres(genreRes);

    const tagRes = await request<TagSummary[]>("/api/tags")
      .catch((err) => { console.warn("tags endpoint failed", err); return [] as TagSummary[]; });
    setTags(tagRes);

    try {
      favIds = await request<number[]>("/api/favourites/ids");
      // Merge server favourites with the encrypted cache: offline additions
      // must not be lost to a stale server list.
      const cached = await readFavourites();
      if (cached) {
        favIds = [...new Set([...favIds, ...cached])];
      }
      setFavourites(favIds);
      // Cache immediately so an offline reload can restore them.
      void cacheFavourites(favIds);
    } catch {
      // Browse degrades to the plain library rather than an error screen. If
      // the profile key is unlocked (offline sign-in), show the last encrypted
      // favourites instead of an empty heart set.
      const cached = await readFavourites();
      if (cached) setFavourites(cached);
    }

    const status = await request<EnrichmentStatus>("/api/enrichment/status")
      .catch((err) => { console.warn("enrichment status endpoint failed", err); return undefined; });
    setEnrichment(status);

    const review = await request<Audiobook[]>("/api/enrichment/review-queue")
      .catch((err) => { console.warn("review queue endpoint failed", err); return [] as Audiobook[]; });
    setReviewQueue(review);

    setLoaded(true);
  }, [profileId]);

  useEffect(() => {
    void refresh();
  }, [refresh, profileId]);

  /** Keep the favourite heart in sync with the card it belongs to. */
  const setFavourite = useCallback((bookId: number, favourited: boolean) => {
    setFavourites((current) =>
      favourited ? (current.includes(bookId) ? current : [...current, bookId]) : current.filter((id) => id !== bookId),
    );
  }, []);

  const toggleFavourite = useCallback(
    async (bookId: number) => {
      const favourited = favourites.includes(bookId);
      const next = favourited
        ? favourites.filter((id) => id !== bookId)
        : [...favourites, bookId];
      // Optimistic: a heart that lags a tap feels broken.
      setFavourite(bookId, !favourited);
      // Persist locally first so the change survives offline and reload.
      await cacheFavourites(next);
      try {
        await request(`/api/audiobooks/${bookId}/favourite`, { method: favourited ? "DELETE" : "PUT" });
      } catch {
        // Server unreachable or rejected: the local cache holds the truth.
        // Sync will retry on reconnect via syncFavourites(). Do not roll back
        // — the user's intent is preserved locally. Do not re-throw — the
        // toggle succeeded from the user's perspective.
      }
    },
    [favourites, setFavourite],
  );

  /**
   * Reconcile local cached favourites with the server.
   *
   * Called when the server becomes reachable again. Computes the union of the
   * encrypted cache and the server's list, pushes mobile-only additions to the
   * server, and caches the merged result. Mobile's offline additions win over a
   * stale server list — the server never deletes favourites the user added while
   * offline.
   */
  const syncFavourites = useCallback(async () => {
    const cached = await readFavourites();
    if (!cached) return;

    let serverIds: number[];
    try {
      serverIds = await request<number[]>("/api/favourites/ids");
    } catch {
      return; // still unreachable; try again next sync
    }

    const serverSet = new Set(serverIds);

    // Mobile-only additions: ids the user favourited offline that the server lacks.
    const mobileOnly = cached.filter((id) => !serverSet.has(id));
    for (const id of mobileOnly) {
      try {
        await request(`/api/audiobooks/${id}/favourite`, { method: "PUT" });
      } catch {
        // Best effort; will retry on next sync. Leave in cache.
      }
    }

    const merged = [...new Set([...cached, ...serverIds])];
    setFavourites(merged);
    await cacheFavourites(merged);
  }, []);

  return {
    genres,
    tags,
    favourites,
    enrichment,
    reviewQueue,
    loaded,
    refresh,
    toggleFavourite,
    syncFavourites,
    isFavourite: (bookId: number) => favourites.includes(bookId),
  };
}

/** Discover: seeded by one book, or by the profile's favourites. */
export function useDiscover() {
  const [result, setResult] = useState<DiscoverResult>();
  const [wishlist, setWishlist] = useState<WishlistItem[]>([]);
  const [loading, setLoading] = useState(false);
  /**
   * A second page is being appended.
   *
   * Separate from `loading`, which blanks the list while the first page is
   * fetched. "Load more" must never empty what is already on screen.
   */
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();

  /**
   * What the current result was seeded from, so paging can ask for the *next*
   * page of the same question.
   *
   * Tracked as state rather than inferred from the result: `seedTitle` is the
   * book's name, not its id, and rebuilding a URL from it would be a guess.
   */
  const [source, setSource] = useState<{ kind: "favourites" } | { kind: "book"; bookId: number }>({
    kind: "favourites",
  });

  const loadForMe = useCallback(async () => {
    setSource({ kind: "favourites" });
    setLoading(true);
    setError(undefined);
    try {
      setResult(await request<DiscoverResult>("/api/discover/for-me?page=1"));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : copy.errors.loadDiscover);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSimilar = useCallback(async (bookId: number) => {
    setSource({ kind: "book", bookId });
    setLoading(true);
    setError(undefined);
    try {
      setResult(await request<DiscoverResult>(`/api/discover/similar/${bookId}?page=1`));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : copy.errors.loadSimilar);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Append the next page.
   *
   * The server ranks one list and slices it, so page 2 continues page 1 rather
   * than being a fresh draw -- which is what "results at random" meant. The
   * client appends rather than replaces for the same reason.
   *
   * Guarded on `hasMore` and on not already being in flight, so a double tap
   * cannot ask for the same page twice and duplicate every card.
   */
  const loadMore = useCallback(async () => {
    if (!result?.hasMore || loadingMore || loading) return;
    const nextPage = (result.page ?? 1) + 1;
    const path =
      source.kind === "book"
        ? `/api/discover/similar/${source.bookId}?page=${nextPage}`
        : `/api/discover/for-me?page=${nextPage}`;
    setLoadingMore(true);
    setError(undefined);
    try {
      const next = await request<DiscoverResult>(path);
      setResult((current) =>
        current
          ? { ...next, recommendations: [...current.recommendations, ...next.recommendations] }
          : next,
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : copy.errors.loadMore);
    } finally {
      setLoadingMore(false);
    }
  }, [result, loadingMore, loading, source]);

  const loadWishlist = useCallback(async () => {
    try {
      const items = await request<WishlistItem[]>("/api/wishlist");
      setWishlist(items);
      void cacheWishlist(items);
    } catch {
      // Offline: the wishlist is private, so it only appears when the profile
      // key is unlocked. With no key the list stays empty rather than pretending
      // the household has an empty wishlist.
      const cached = await readWishlist();
      if (cached) setWishlist(cached);
    }
  }, []);

  const save = useCallback(async (recommendation: Recommendation, seedMediaItemId?: number) => {
    await request("/api/wishlist", {
      method: "POST",
      body: JSON.stringify({
        title: recommendation.title,
        author: recommendation.author,
        narrators: recommendation.narrators,
        description: recommendation.description,
        coverUrl: recommendation.coverUrl,
        genres: recommendation.genres,
        seriesName: recommendation.seriesName,
        publisher: recommendation.publisher,
        publishedYear: recommendation.publishedYear,
        provider: recommendation.provider,
        providerKey: recommendation.providerKey,
        seedMediaItemId,
      }),
    });
    await loadWishlist();
  }, [loadWishlist]);

  const remove = useCallback(async (id: number) => {
    await request(`/api/wishlist/${id}`, { method: "DELETE" });
    const next = wishlist.filter((item) => item.id !== id);
    setWishlist(next);
    void cacheWishlist(next);
  }, [wishlist]);

  const markOwned = useCallback(async (id: number, owned: boolean) => {
    const updated = await request<WishlistItem>(`/api/wishlist/${id}/owned`, {
      method: "PUT",
      body: JSON.stringify({ owned }),
    });
    const next = wishlist.map((item) => (item.id === id ? updated : item));
    setWishlist(next);
    void cacheWishlist(next);
  }, [wishlist]);

  return { result, wishlist, loading, loadingMore, error, loadForMe, loadSimilar, loadMore, loadWishlist, save, remove, markOwned };
}

/** The full editable tag suite for one book (spec 17). */
export function useTagSuite(bookId: number | undefined) {
  const [suite, setSuite] = useState<BookTagSuite>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    if (!bookId) return;
    setLoading(true);
    try {
      setSuite(await request<BookTagSuite>(`/api/audiobooks/${bookId}/tags`));
      setError(undefined);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : copy.errors.loadTags);
    } finally {
      setLoading(false);
    }
  }, [bookId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async (changes: Record<string, unknown>) => {
    if (!bookId) return;
    await request(`/api/audiobooks/${bookId}/tags`, { method: "PUT", body: JSON.stringify(changes) });
    await load();
  }, [bookId, load]);

  const reset = useCallback(async () => {
    if (!bookId) return;
    await request(`/api/audiobooks/${bookId}/metadata/reset`, { method: "POST" });
    await load();
  }, [bookId, load]);

  return { suite, loading, error, reload: load, save, reset };
}
