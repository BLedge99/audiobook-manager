/**
 * The derived-library bundle (spec 43 phase 6.2, extract-only).
 *
 * Everything here is a pure projection of the merged shelf. It lived inline
 * in App.tsx, where it dominated the middle of the component; the rules did
 * not change, only where they are written. Each memo keeps the same deps it
 * had inline — the ETag-coalesced refresh in `useLibrary` already guarantees
 * the books array only changes identity when content does.
 */
import { useMemo } from "react";
import type { Audiobook, GenreNode } from "../types";
import type { Filters } from "./browse";
import { applyFilters, buildGenreShelves, buildSeriesShelves } from "./browse";
import { applySearch } from "./search";
import { isFromThisServer } from "./api";
import { mergeShelves } from "../local/librarySource";
import { isKidsAccount } from "../local/kids";

export interface DerivedLibraryInput {
  offline: boolean;
  /** Server books (already ETag-coalesced) — skipped entirely when offline. */
  books: Audiobook[];
  /** Books on this device (the offline shelf). */
  deviceBooks: Audiobook[];
  /** Session role, for the kids-account catalogue gate (spec 38). */
  sessionRole?: string | null;
  ageBand?: string | null;
  favourites: number[];
  reviewQueue: Audiobook[];
  genres: GenreNode[];
  /** The URL-state filters and typed search. */
  filters: Filters;
  search: string;
  /** Where the connected server lives — merged-shelf attribution depends on it. */
  serverUrl: string;
}

export function useDerivedLibrary(input: DerivedLibraryInput) {
  const {
    offline,
    books,
    deviceBooks,
    sessionRole,
    ageBand,
    favourites,
    reviewQueue,
    genres,
    filters,
    search,
    serverUrl,
  } = input;

  /**
   * Which books to show. Normally the live server library; when the server
   * cannot be reached, the device replica instead of an error over an empty
   * shelf (spec 29).
   */
  const libraryBooks = useMemo(
    () =>
      mergeShelves(
        offline ? null : { books, serverId: serverUrl },
        { books: deviceBooks },
        serverUrl,
        isKidsAccount(sessionRole) ? { role: "child", ageBand: ageBand ?? null } : undefined,
      ),
    [offline, books, deviceBooks, sessionRole, ageBand, serverUrl],
  );

  const favouriteIds = useMemo(() => new Set(favourites), [favourites]);
  // Search narrows the chip-filtered result rather than replacing it, so both
  // layers apply and neither can widen the other.
  const filteredBooks = useMemo(
    () => applySearch(applyFilters(libraryBooks, filters), search),
    [libraryBooks, filters, search],
  );
  // The Library tab applies the typed search but not the chip filters.
  const searchedBooks = useMemo(() => applySearch(libraryBooks, search), [libraryBooks, search]);
  const favouriteBooks = useMemo(
    // Favourites name ids on the connected server; a merged shelf can hold the
    // same id belonging to another server's book.
    () => libraryBooks.filter((book) => isFromThisServer(book) && favouriteIds.has(book.id)),
    [libraryBooks, favouriteIds],
  );

  const reviewIds = useMemo(
    () => new Set(reviewQueue.map((book) => book.id)),
    [reviewQueue],
  );

  const genreLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const parent of genres) {
      map.set(parent.slug, parent.name);
      for (const child of parent.children ?? []) map.set(child.slug, child.name);
    }
    return map;
  }, [genres]);

  const genreShelves = useMemo(
    () => buildGenreShelves(filteredBooks, { labels: { genres: genreLabels } }),
    [filteredBooks, genreLabels],
  );
  const seriesShelves = useMemo(() => buildSeriesShelves(filteredBooks), [filteredBooks]);

  return {
    libraryBooks,
    favouriteIds,
    filteredBooks,
    searchedBooks,
    favouriteBooks,
    reviewIds,
    genreLabels,
    genreShelves,
    seriesShelves,
  };
}
