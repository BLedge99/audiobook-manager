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
  const response = await fetch(url, {
    ...options,
    headers: { ...headers, ...(options?.headers as Record<string, string> | undefined) },
  });
  if (!response.ok) {
    const body = await response.text();
    let message = body;
    try {
      message = JSON.parse(body).message || body;
    } catch {
      /* not json */
    }
    throw new Error(message || `Request failed (${response.status})`);
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

  const refresh = useCallback(async () => {
    try {
      const [genreTree, tagList, favIds, status, review] = await Promise.all([
        request<GenreNode[]>("/api/genres"),
        request<TagSummary[]>("/api/tags"),
        request<number[]>("/api/favourites/ids"),
        request<EnrichmentStatus>("/api/enrichment/status"),
        request<Audiobook[]>("/api/enrichment/review-queue"),
      ]);
      setGenres(genreTree);
      setTags(tagList);
      setFavourites(favIds);
      setEnrichment(status);
      setReviewQueue(review);
    } catch {
      // Browse degrades to the plain library rather than an error screen.
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Keep the favourite heart in sync with the card it belongs to. */
  const setFavourite = useCallback((bookId: number, favourited: boolean) => {
    setFavourites((current) =>
      favourited ? (current.includes(bookId) ? current : [...current, bookId]) : current.filter((id) => id !== bookId),
    );
  }, []);

  const toggleFavourite = useCallback(
    async (bookId: number) => {
      const favourited = favourites.includes(bookId);
      // Optimistic: a heart that lags a tap feels broken.
      setFavourite(bookId, !favourited);
      try {
        await request(`/api/audiobooks/${bookId}/favourite`, { method: favourited ? "DELETE" : "PUT" });
      } catch (error) {
        setFavourite(bookId, favourited); // roll back
        throw error;
      }
    },
    [favourites, setFavourite],
  );

  return {
    genres,
    tags,
    favourites,
    enrichment,
    reviewQueue,
    loaded,
    refresh,
    toggleFavourite,
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
      setError(requestError instanceof Error ? requestError.message : "Unable to load Discover");
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
      setError(requestError instanceof Error ? requestError.message : "Unable to find similar books");
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
      setError(requestError instanceof Error ? requestError.message : "Unable to load more suggestions");
    } finally {
      setLoadingMore(false);
    }
  }, [result, loadingMore, loading, source]);

  const loadWishlist = useCallback(async () => {
    try {
      setWishlist(await request<WishlistItem[]>("/api/wishlist"));
    } catch {
      /* surfaced as an empty list */
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
    setWishlist((current) => current.filter((item) => item.id !== id));
  }, []);

  const markOwned = useCallback(async (id: number, owned: boolean) => {
    const updated = await request<WishlistItem>(`/api/wishlist/${id}/owned`, {
      method: "PUT",
      body: JSON.stringify({ owned }),
    });
    setWishlist((current) => current.map((item) => (item.id === id ? updated : item)));
  }, []);

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
      setError(requestError instanceof Error ? requestError.message : "Unable to load tags");
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