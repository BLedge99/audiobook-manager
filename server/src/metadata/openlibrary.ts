/**
 * Open Library provider client (spec 07 / spec 16).
 *
 * This is the module LibriVox's and Audnexus's peers live next to, so the
 * chain treats all four the same way. Previously it lived one directory up in
 * `enrichment.ts` and the chain re-mapped every field by hand.
 */
import { similarity, trimDescription, type MetadataProvider, type EnrichmentQuery, type ProviderCandidate } from "./types";
import {
  firstString,
  isNonBookTitle,
  normalizeSubjects,
  parseSeriesPosition,
  pickLanguage,
} from "./provider-utils";
import type { MappedFields } from "./provider-utils";

/**
 * Fields for a candidate, from an Open Library search doc.
 *
 * Pure and exported so the mapping is unit-testable without a network call.
 * `subject`, `publisher` and `isbn` are only present when the search requests
 * them via `fields=` -- see `OPEN_LIBRARY_FIELDS`.
 */
export function mapOpenLibraryDoc(doc: Record<string, unknown>): MappedFields {
  const year = doc.first_publish_year;
  return {
    title: String(doc.title ?? "Unknown"),
    author: firstString(doc.author_name),
    coverUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : undefined,
    publisher: firstString(doc.publisher),
    isbn: firstString(doc.isbn),
    language: pickLanguage(doc.language),
    publishedYear:
      typeof year === "number" && Number.isFinite(year) && year > 1400 && year <= new Date().getFullYear() + 1
        ? year
        : undefined,
    seriesName: firstString(doc.series_name),
    seriesPosition: parseSeriesPosition(doc.series_position),
    genres: normalizeSubjects(doc.subject),
    workKey: typeof doc.key === "string" ? doc.key : undefined,
  };
}

/**
 * Open Library search only returns these when `fields=` asks for them.
 * Without it, `subject`, `publisher` and `isbn` are simply absent -- which is
 * why genres were empty for every book that LibriVox did not match.
 */
export const OPEN_LIBRARY_FIELDS = [
  "key",
  "title",
  "author_name",
  "cover_i",
  "first_publish_year",
  "subject",
  "publisher",
  "isbn",
  "language",
  "series_name",
  "series_position",
  "edition_key",
  "edition_count",
].join(",");

export async function searchOpenLibrary(title: string, _author?: string): Promise<ProviderCandidate[]> {
  const query = encodeURIComponent(title);
  const res = await fetch(
    `https://openlibrary.org/search.json?q=${query}&limit=10&fields=${encodeURIComponent(OPEN_LIBRARY_FIELDS)}`,
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { docs?: Record<string, unknown>[] };
  return (data.docs ?? [])
    .map((doc) => {
      const mapped = mapOpenLibraryDoc(doc);
      return {
        source: "openlibrary" as const,
        ...mapped,
        description: undefined, // fetched lazily, and only if still missing
        confidence: similarity(title, String(doc.title ?? "")),
        raw: doc,
      };
    })
    // Prefer the work itself over anything published *about* it.
    .filter((candidate) => !isNonBookTitle(candidate.title))
    .slice(0, 5);
}

/**
 * Search Open Library by subject rather than by title.
 *
 * This exists because Discover cannot work any other way, and the reason is
 * worth keeping next to the code:
 *
 *  - Audnexus has no free title search. `AudnexusProvider.search()` is a
 *    deliberate no-op that returns `[]` unless the caller already holds an ASIN,
 *    so it contributes zero candidates to Discover, always.
 *  - LibriVox does *exact* title matching, and Discover's only input is genre
 *    names. Asking LibriVox for a book titled "fiction" returns 404. Asking for
 *    "short stories" returns exactly one book, one literally titled that.
 *
 * Open Library's `search.json` is the only free endpoint here that accepts a
 * concept instead of a title. Measured: `subject:horror` returns ~35,000 docs,
 * no API key, no auth.
 *
 * The trade, stated plainly: these are *print* records, so they carry no
 * narrator and no runtime. A suggestion from here is a book the household does
 * not own, not an audiobook they can buy. The UI labels them accordingly rather
 * than implying they are playable.
 */
/**
 * One GET against Open Library.
 *
 * Three things every call to this host needs, gathered here so a new endpoint
 * cannot forget one:
 *
 *  - **An identifying `User-Agent`.** Open Library asks applications to
 *    identify themselves, and grants identified requests **3x** the anonymous
 *    rate limit. The anonymous budget is roughly 100 requests per 5 minutes
 *    per IP, and exceeding it returns 403 — which is indistinguishable, from
 *    the app's point of view, from "this provider is down".
 *  - **A timeout.** Discover's complaint was literally "it serves no results
 *    for a while, then suddenly spams results". A hung request is half of
 *    that: the tab sits on nothing with no explanation and no way to stop
 *    waiting.
 *  - **Honest failure.** Returns undefined rather than throwing, because spec
 *    16's rule is that one provider being down degrades results instead of
 *    failing the request.
 */
async function openLibraryGet(url: string, timeoutMs = 8000): Promise<Response | undefined> {
  try {
    return await fetch(url, {
      headers: { "User-Agent": "Bookle/1.0 (local-first audiobook server; https://github.com/local/bookle)" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return undefined;
  }
}

/** How long a subject pool stays usable before it is re-fetched. */
const SUBJECT_CACHE_TTL_MS = 30 * 60 * 1000;

/** Bound on cached pools, so a long-lived server cannot grow without limit. */
const SUBJECT_CACHE_MAX = 120;

const subjectPoolCache = new Map<string, { at: number; candidates: ProviderCandidate[] }>();

/**
 * Fetch one page of an Open Library subject search.
 *
 * Paging uses the documented `page` + `limit` pair (page starts at 1).
 */
export async function searchOpenLibraryBySubject(
  subject: string,
  options: { limit?: number; page?: number } = {},
): Promise<ProviderCandidate[]> {
  const limit = options.limit ?? 12;
  const page = Math.max(1, options.page ?? 1);
  const cacheKey = `${subject}:${limit}:${page}`;

  const cached = subjectPoolCache.get(cacheKey);
  if (cached && Date.now() - cached.at < SUBJECT_CACHE_TTL_MS) return cached.candidates;

  const query = encodeURIComponent(`subject:${subject}`);
  const res = await openLibraryGet(
    `https://openlibrary.org/search.json?q=${query}&page=${page}&limit=${limit}&fields=${encodeURIComponent(OPEN_LIBRARY_FIELDS)}`,
  );
  if (!res?.ok) return cached?.candidates ?? [];

  const data = (await res.json()) as { docs?: Record<string, unknown>[] };
  const candidates = (data.docs ?? [])
    .map((doc) => ({
      source: "openlibrary" as const,
      ...mapOpenLibraryDoc(doc),
      description: undefined,
      // Subject search is a topical match, not a title match, so confidence is
      // a flat middling value rather than a similarity score.
      confidence: 0.5,
      raw: doc,
    }))
    .filter((candidate) => candidate.title && !isNonBookTitle(candidate.title));

  // Evict oldest-first. `Map` preserves insertion order.
  if (subjectPoolCache.size >= SUBJECT_CACHE_MAX) {
    const oldest = subjectPoolCache.keys().next().value;
    if (oldest) subjectPoolCache.delete(oldest);
  }
  subjectPoolCache.set(cacheKey, { at: Date.now(), candidates });
  return candidates;
}

/** Test seam: forget every cached subject pool. */
export function clearSubjectPoolCache(): void {
  subjectPoolCache.clear();
}

/**
 * Fetch a work description from Open Library, on demand.
 *
 * Search results carry no description, and the work record is a second request
 * per book. So this is only called when nothing else supplied one.
 */
export async function fetchOpenLibraryDescription(workKey: string | undefined): Promise<string | undefined> {
  if (!workKey || !/^\/works\/[A-Za-z0-9]+$/.test(workKey)) return undefined;
  try {
    const res = await fetch(`https://openlibrary.org${workKey}.json`);
    if (!res.ok) return undefined;
    const data = (await res.json()) as { description?: unknown };
    const value = data.description;
    // Open Library returns either a bare string or a shape carrying `value`,
    // sometimes keyed by language.
    if (typeof value === "string") return trimDescription(value);
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (typeof record.value === "string") return trimDescription(record.value);
      const translated = Object.entries(record).find(
        ([key, entry]) => key !== "type" && typeof entry === "string" && entry.trim().length > 0,
      );
      if (translated) return trimDescription(translated[1] as string);
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export class OpenLibraryProvider implements MetadataProvider {
  id = "openlibrary" as const;
  supportsRichFields = false;

  async search(query: EnrichmentQuery): Promise<ProviderCandidate[]> {
    return searchOpenLibrary(query.title, query.authorIsUnknown ? undefined : query.author);
  }
}
