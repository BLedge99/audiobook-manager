import type { Audiobook } from "../types";

/**
 * Spec 20 — browsing, filtering and shelf grouping.
 *
 * Pure and dependency-free so the rules that decide what a user sees are
 * unit-testable rather than buried in JSX. This is the same discipline spec 14
 * applied to position maths.
 */

export type FacetKey = "genre" | "author" | "narrator" | "series" | "tag";

export type Filters = Partial<Record<FacetKey, string[]>>;

export const EMPTY_FILTERS: Filters = {};

export function isFilterActive(filters: Filters): boolean {
  return Object.values(filters).some((values) => Boolean(values?.length));
}

export function activeFilterCount(filters: Filters): number {
  return Object.values(filters).reduce((total, values) => total + (values?.length ?? 0), 0);
}

/** Toggling is idempotent: selecting an active value removes it. */
export function toggleFilter(filters: Filters, facet: FacetKey, value: string): Filters {
  const current = filters[facet] ?? [];
  const next = current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value];
  const updated: Filters = { ...filters, [facet]: next };
  if (next.length === 0) delete updated[facet];
  return updated;
}

export function clearFacet(filters: Filters, facet: FacetKey): Filters {
  const updated = { ...filters };
  delete updated[facet];
  return updated;
}

// --- Facet extraction -----------------------------------------------------

/** The values a book offers for one facet, in display order. */
export function facetValues(book: Audiobook, facet: FacetKey): string[] {
  switch (facet) {
    case "genre":
      return (book.genres ?? []).map((genre) => genre.slug);
    case "author":
      return book.author ? [book.author] : [];
    case "narrator":
      // Prefer the reconciled contributor rows (spec 17); fall back to the
      // legacy comma-joined string so older rows still filter correctly.
      const narrators = (book.contributors ?? []).filter((entry) => entry.role === "narrator").map((entry) => entry.name);
      if (narrators.length > 0) return narrators;
      return book.narrator
        ? book.narrator.split(",").map((name) => name.trim()).filter(Boolean)
        : [];
    case "series":
      return book.series ? [book.series.name] : [];
    case "tag":
      return (book.customTags ?? []).map((tag) => tag.name);
    default:
      return [];
  }
}

function matchesFacet(book: Audiobook, facet: FacetKey, selected: string[]): boolean {
  if (selected.length === 0) return true;
  const values = facetValues(book, facet);
  // OR within a facet: picking two genres shows both.
  return selected.some((value) => values.includes(value));
}

/**
 * Apply filters. AND across facets, OR within one.
 *
 * A book with no value for a facet is excluded when that facet is filtered --
 * otherwise filtering by "narrator" would surface every book without a
 * narrator, which is the opposite of what the user asked for.
 */
export function applyFilters(books: Audiobook[], filters: Filters): Audiobook[] {
  if (!isFilterActive(filters)) return books;
  const activeFacets = (Object.keys(filters) as FacetKey[]).filter(
    (facet) => (filters[facet]?.length ?? 0) > 0,
  );
  return books.filter((book) => activeFacets.every((facet) => matchesFacet(book, facet, filters[facet]!)));
}

// --- Facet options --------------------------------------------------------

export interface FacetOption {
  value: string;
  label: string;
  count: number;
}

/**
 * Every selectable value for a facet with its book count, most common first.
 *
 * Counts come from the same book list the options are rendered from, so a
 * count can never disagree with what clicking it would return.
 */
export function facetOptions(books: Audiobook[], facet: FacetKey, labels?: Map<string, string>): FacetOption[] {
  const counts = new Map<string, number>();
  for (const book of books) {
    for (const value of facetValues(book, facet)) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, label: labels?.get(value) ?? value, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

// --- Shelves --------------------------------------------------------------

export interface Shelf {
  key: string;
  title: string;
  books: Audiobook[];
}

/** A shelf of at least this many books, so shelves are not single-book noise. */
export const MIN_SHELF_SIZE = 2;

/** How many shelves to render before it stops feeling like browsing. */
export const MAX_SHELVES = 12;

export interface ShelfLabels {
  genres?: Map<string, string>;
  series?: (name: string) => string;
}

/**
 * Group books into genre shelves, largest first.
 *
 * A book appears in every genre it carries, so shelves overlap; that is what
 * makes them a browse surface rather than a partition.
 */
export function buildGenreShelves(
  books: Audiobook[],
  options: { minSize?: number; max?: number; labels?: ShelfLabels } = {},
): Shelf[] {
  const minSize = options.minSize ?? MIN_SHELF_SIZE;
  const max = options.max ?? MAX_SHELVES;
  const grouped = new Map<string, Audiobook[]>();

  for (const book of books) {
    for (const genre of book.genres ?? []) {
      const list = grouped.get(genre.slug) ?? [];
      list.push(book);
      grouped.set(genre.slug, list);
    }
  }

  return [...grouped.entries()]
    .filter(([, shelfBooks]) => shelfBooks.length >= minSize)
    .map(([slug, shelfBooks]) => ({
      key: `genre:${slug}`,
      title: options.labels?.genres?.get(slug) ?? slug,
      books: shelfBooks,
    }))
    .sort((a, b) => b.books.length - a.books.length || a.title.localeCompare(b.title))
    .slice(0, max);
}

/**
 * Order a series by reading position.
 *
 * Fractional positions sort between books (2.5 after 2), nulls sort last, and
 * title is the final tiebreak so the order is stable across renders.
 */
export function sortBySeriesPosition(books: Audiobook[]): Audiobook[] {
  return [...books].sort((a, b) => {
    const left = a.seriesPosition ?? Number.POSITIVE_INFINITY;
    const right = b.seriesPosition ?? Number.POSITIVE_INFINITY;
    if (left !== right) return left - right;
    return a.title.localeCompare(b.title);
  });
}

/** Group books into series shelves in reading order. */
export function buildSeriesShelves(books: Audiobook[], minSize = 1): Shelf[] {
  const grouped = new Map<string, Audiobook[]>();
  for (const book of books) {
    if (!book.series) continue;
    const list = grouped.get(book.series.name) ?? [];
    list.push(book);
    grouped.set(book.series.name, list);
  }
  return [...grouped.entries()]
    .filter(([, shelfBooks]) => shelfBooks.length >= minSize)
    .map(([name, shelfBooks]) => ({ key: `series:${name}`, title: name, books: sortBySeriesPosition(shelfBooks) }))
    .sort((a, b) => b.books.length - a.books.length || a.title.localeCompare(b.title));
}

/** "Book 2 of 5", or null when the position is unknown. */
export function seriesLabel(book: Audiobook, total: number): string | null {
  if (book.seriesPosition === null || book.seriesPosition === undefined) return null;
  return `Book ${book.seriesPosition} of ${total}`;
}

// --- URL state ------------------------------------------------------------

/**
 * Serialise filters into a nested query string, e.g.
 * `f=genre%3Dscience-fiction%26narrator%3DSimon+Vance`.
 *
 * Facets are emitted in a fixed order so an equivalent filter set always
 * produces an identical URL and is shareable/bookmarkable.
 *
 * The nested `f=` form is used so the URL can carry the active tab alongside
 * the filters without the two namespaces colliding.
 */
export function filtersToQuery(filters: Filters): string {
  const params = new URLSearchParams();
  for (const facet of ["genre", "author", "narrator", "series", "tag"] as FacetKey[]) {
    const values = filters[facet];
    if (values?.length) params.set(facet, values.join("|"));
  }
  return params.toString();
}

/**
 * Parse a query string back into filters.
 *
 * Reads the nested `f=` value written by `filtersToQuery`, and still accepts
 * bare top-level facet keys so an older shared link keeps working.
 */
export function filtersFromQuery(query: string): Filters {
  const outer = new URLSearchParams(query);
  const nested = outer.get("f");
  const params = new URLSearchParams(nested ?? query);

  const filters: Filters = {};
  for (const facet of ["genre", "author", "narrator", "series", "tag"] as FacetKey[]) {
    const raw = params.get(facet);
    if (!raw) continue;
    const values = raw.split("|").map((value) => value.trim()).filter(Boolean);
    if (values.length > 0) filters[facet] = values;
  }
  return filters;
}