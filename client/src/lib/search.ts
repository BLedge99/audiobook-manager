import type { Audiobook } from "../types";
import { facetValues } from "./browse";

/**
 * Spec 22 — typed search.
 *
 * The chips in the filter bar can only offer values that already exist, and
 * they match exactly, so `rowling` cannot find `J.K. Rowling`. This adds a
 * typed layer over the same fields: bare words search everything, and
 * `author:` / `genre:` narrow to one facet.
 *
 * Deliberately a *separate* layer from `Filters` (the chip state). A typed
 * value is normally a substring rather than an exact facet value, so pushing
 * it into `Filters` would match nothing and silently blank the library. Both
 * layers apply; the typed one narrows the output of the chip one.
 *
 * Pure and DOM-free, same discipline spec 14 and spec 20 used, so the matching
 * rules are unit-testable rather than buried in a component.
 */

/** Fields that can appear as `field:value`. */
export const SEARCH_FIELDS = ["author", "narrator", "genre", "series", "tag"] as const;

export type SearchField = (typeof SEARCH_FIELDS)[number];

/** Fields are matched case-insensitively, so accept any casing and singulars. */
const FIELD_ALIASES: Record<string, SearchField> = {
  author: "author",
  authors: "author",
  writer: "author",
  narrator: "narrator",
  narrators: "narrator",
  reader: "narrator",
  genre: "genre",
  genres: "genre",
  series: "series",
  tag: "tag",
  tags: "tag",
};

export interface ParsedQuery {
  /** Bare words, matched against every searchable field. */
  terms: string[];
  /** `field:value` terms, grouped by facet. */
  facets: Partial<Record<SearchField, string[]>>;
  /** True when the query had no usable content at all. */
  empty: boolean;
}

export const EMPTY_QUERY: ParsedQuery = { terms: [], facets: {}, empty: true };

/**
 * One token: `field:"quoted value"`, `field: value` or a bare word.
 *
 * The `\s*` around the colon is load-bearing: without it the optional field
 * group cannot match `author:` followed by a space, the whole optional group
 * rolls back, and `author: rowling` silently degrades to two free-text terms.
 */
const TOKEN = /(?:([A-Za-z]+)\s*:\s*)?(?:"([^"]*)"|'([^']*)'|(\S+))/g;

/**
 * Split a query into free-text terms and facet terms.
 *
 * An unrecognised `field:` is kept as a free-text term rather than dropped, so
 * `isbn:12345` or a typo degrades to an ordinary search instead of quietly
 * matching nothing. A `field:` with no value at all is dropped -- there is
 * nothing to match.
 */
export function parseSearchQuery(query: string | null | undefined): ParsedQuery {
  const terms: string[] = [];
  const facets: Partial<Record<SearchField, string[]>> = {};

  if (!query) return EMPTY_QUERY;

  TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN.exec(query)) !== null) {
    const rawField = match[1]?.toLowerCase();
    // Quoted, single-quoted or bare -- whichever the token used.
    const rawValue = (match[2] ?? match[3] ?? match[4] ?? "").trim();
    if (rawValue.length === 0) continue;

    const field = rawField ? FIELD_ALIASES[rawField] : undefined;
    if (rawField && !field) {
      // Unknown field: search the whole `field:value` string as plain text.
      terms.push(`${rawField}:${rawValue}`);
      continue;
    }
    if (!field) {
      // `author:` with nothing after it. The regex has already rolled the field
      // group back, so this arrives as the bare word "author:". Dropping it is
      // better than keeping it: a stray "author:" would otherwise be searched
      // for as literal text, match nothing, and show an empty library with no
      // explanation.
      if (/^[A-Za-z]+:$/.test(rawValue)) continue;
      terms.push(rawValue);
      continue;
    }
    const bucket = facets[field] ?? [];
    // De-duplicate case-insensitively so `author:A author:a` is one term.
    if (!bucket.some((entry) => entry.toLowerCase() === rawValue.toLowerCase())) {
      bucket.push(rawValue);
    }
    facets[field] = bucket;
  }

  const empty = terms.length === 0 && Object.keys(facets).length === 0;
  return { terms, facets, empty };
}

function includesInsensitive(haystack: string | null | undefined, needle: string): boolean {
  if (!haystack) return false;
  return haystack.toLowerCase().includes(needle);
}

/** Every facet value a book offers, across all searchable facets. */
function allFacetValues(book: Audiobook): string[] {
  return SEARCH_FIELDS.flatMap((field) => facetValues(book, field));
}

/**
 * Match one book against a parsed query. Every term must match (AND).
 *
 * Facet terms resolve through `facetValues`, the same source the chips use, so
 * a typed `author:` and a clicked Author chip can never disagree about who the
 * author is.
 */
export function matchesSearch(book: Audiobook, query: ParsedQuery): boolean {
  if (query.empty) return true;

  for (const term of query.terms) {
    const needle = term.toLowerCase();
    const haystacks = [
      book.title,
      book.author,
      book.narrator,
      book.series?.name,
      book.description,
      ...allFacetValues(book),
    ];
    if (!haystacks.some((value) => includesInsensitive(value, needle))) return false;
  }

  for (const [field, values] of Object.entries(query.facets) as [SearchField, string[]][]) {
    const available = facetValues(book, field);
    const matched = values.some((value) =>
      available.some((entry) => includesInsensitive(entry, value.toLowerCase())),
    );
    if (!matched) return false;
  }

  return true;
}

/** Narrow a list of books by a raw query string. */
export function applySearch(books: Audiobook[], query: string | null | undefined): Audiobook[] {
  const parsed = parseSearchQuery(query);
  if (parsed.empty) return books;
  return books.filter((book) => matchesSearch(book, parsed));
}

// --- URL state -------------------------------------------------------------

/** Serialise the query for the URL, or "" when there is nothing to store. */
export function searchToQueryParam(query: string | null | undefined): string {
  return (query ?? "").trim();
}

export function searchFromQueryParam(search: string | null | undefined): string {
  return search ?? "";
}

/**
 * A short human summary of an active query, for the "searching for" line.
 * Falls back to the raw text when the query does not parse into facets.
 */
export function describeSearch(query: string | null | undefined): string {
  const parsed = parseSearchQuery(query);
  if (parsed.empty) return "";
  const parts: string[] = [];
  // Emit facets in a fixed order so the same query always reads the same way.
  for (const field of SEARCH_FIELDS) {
    const values = parsed.facets[field];
    if (values?.length) parts.push(`${field}: ${values.join(", ")}`);
  }
  if (parsed.terms.length > 0) parts.push(parsed.terms.join(" "));
  return parts.join(" · ");
}