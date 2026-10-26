import {
  scoreMatch,
  trimDescription,
  type EnrichmentQuery,
  type MetadataProvider,
  type ProviderCandidate,
  type ProviderChapter,
} from "./types";

/**
 * Spec 16 / 21 — Audnexus provider.
 *
 * NOTE ON THE API SHAPE (corrected 2026-10-12): the base host is
 * `api.audnex.us`, not `audnex.us`, and there is **no book-search endpoint**.
 * The public API exposes only:
 *   GET /authors?name=...        find authors by name
 *   GET /authors/{ASIN}
 *   GET /books/{ASIN}            by id, not by title
 *   GET /books/{ASIN}/chapters   official chapter titles, no token needed
 *   GET /health
 *
 * The earlier implementation searched `audnex.us/books?title=`, which has
 * returned 404 for every request since it was written -- which is why no book
 * was ever enriched by Audnexus and the ADR 008 premise went unnoticed.
 *
 * Consequence: Audnexus can only enrich a book we already hold an ASIN for. It
 * is therefore not part of the title-driven search chain; it is an ASIN-keyed
 * lookup used for chapter titles (spec 21).
 */

const BASE = "https://api.audnex.us";

/** Cover sizes Audnexus offers. -M is a sane default; -XL is ~3200px. */
const COVER_SIZE = "-M";

interface AudnexusNamed {
  asin?: string;
  name?: string;
  type?: string;
}

interface AudnexusAuthor {
  asin?: string;
  name?: string;
  similar?: AudnexusAuthor[];
}

interface AudnexusSeries {
  asin?: string;
  name?: string;
  sequence?: string;
}

interface AudnexusBook {
  asin?: string;
  title?: string;
  subtitle?: string;
  description?: string;
  image?: string;
  region?: string;
  language?: string;
  publisherName?: string;
  releaseDate?: string;
  runtimeLengthMin?: number;
  genres?: AudnexusNamed[];
  tags?: AudnexusNamed[];
  authors?: AudnexusAuthor[];
  narrators?: AudnexusNamed[];
  seriesPrimary?: AudnexusSeries;
  seriesSecondary?: AudnexusSeries[];
}

function parseYear(releaseDate: string | undefined): number | undefined {
  if (!releaseDate) return undefined;
  const match = releaseDate.match(/^(\d{4})/);
  if (!match) return undefined;
  const year = Number(match[1]);
  return Number.isFinite(year) && year > 1000 ? year : undefined;
}

/** Audnexus sequence can be "1", "2", or "1.5" for interstitial novellas. */
export function parseSequence(sequence: string | undefined): number | undefined {
  if (!sequence) return undefined;
  const parsed = Number.parseFloat(sequence);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function names(items: AudnexusNamed[] | undefined): string[] {
  if (!items) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const name = item.name?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}

/**
 * Genres carry hierarchy: Audnexus emits up to 2 `type: "genre"` entries
 * (parents) and up to 4 `type: "tag"` entries (sub-genres, e.g. "Space Opera")
 * **within the same `genres` array**, distinguished only by `type`. Some
 * responses also carry a separate `tags` array, so both are read.
 *
 * The taxonomy mapper (spec 17) decides what to do with them; here we just
 * flatten parents first, then sub-genres.
 */
export function mapAudnexusGenres(book: AudnexusBook): string[] {
  const all = [...(book.genres ?? []), ...(book.tags ?? [])];
  const parents = names(all.filter((genre) => genre.type === "genre"));
  const subs = names(all.filter((genre) => genre.type === "tag"));
  // Anything with no explicit type is still a genre; do not silently drop it.
  const untyped = names(all.filter((genre) => !genre.type));
  return [...parents, ...subs, ...untyped];
}

export function mapAudnexusBook(book: AudnexusBook, query: EnrichmentQuery): ProviderCandidate | null {
  const baseTitle = book.title?.trim();
  if (!baseTitle) return null;
  // Audnexus splits subtitle out; the scanner derives one title string, so
  // fold it back for an honest comparison.
  const title = book.subtitle?.trim() ? `${baseTitle}: ${book.subtitle.trim()}` : baseTitle;

  const author = book.authors?.[0]?.name?.trim();
  const coverUrl = book.image ? `${book.image.replace(/\.(jpg|png|webp)$/i, "")}${COVER_SIZE}.jpg` : undefined;

  return {
    source: "audnexus",
    providerKey: book.asin,
    title,
    author,
    narrators: names(book.narrators),
    seriesName: book.seriesPrimary?.name?.trim(),
    seriesPosition: parseSequence(book.seriesPrimary?.sequence),
    publisher: book.publisherName?.trim(),
    publishedYear: parseYear(book.releaseDate),
    language: book.language,
    genres: mapAudnexusGenres(book),
    coverUrl,
    description: trimDescription(book.description),
    confidence: scoreMatch(query, title, author),
    raw: book,
  };
}

export class AudnexusProvider implements MetadataProvider {
  id = "audnexus" as const;
  supportsRichFields = true;

  constructor(
    private region = process.env.AUDEXUS_REGION || "us",
    private timeoutMs = 10_000,
  ) {}

  async search(query: EnrichmentQuery): Promise<ProviderCandidate[]> {
    // Audnexus has no title search, so this only ever returns a book we already
    // hold an ASIN for. Kept in the provider interface so the chain can consume
    // it uniformly, but it is a local no-op rather than an HTTP call against an
    // endpoint that does not exist.
    const asin = query.asin ?? extractAsin(query.filePath) ?? extractAsin(query.title);
    if (!asin) return [];
    const book = await this.bookByAsin(asin);
    if (!book) return [];
    const mapped = mapAudnexusBook(book, query);
    return mapped ? [mapped] : [];
  }

  /** GET /books/{ASIN} — full audiobook metadata for a known ASIN. */
  async bookByAsin(asin: string): Promise<AudnexusBook | null> {
    try {
      const res = await fetch(`${BASE}/books/${encodeURIComponent(asin)}?region=${this.region}`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) return null;
      return (await res.json()) as AudnexusBook;
    } catch {
      return null;
    }
  }

  /**
   * GET /books/{ASIN}/chapters — official chapter titles with offsets.
   *
   * Free and token-free, which is what makes this worth having despite needing
   * an ASIN up front. `isAccurate` is the provider's own confidence flag; an
   * inaccurate list is still returned because partial chapter data beats none,
   * but callers can choose to ignore it.
   */
  async chaptersByAsin(asin: string): Promise<{ chapters: ProviderChapter[]; isAccurate: boolean }> {
    try {
      const res = await fetch(`${BASE}/books/${encodeURIComponent(asin)}/chapters?region=${this.region}`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) return { chapters: [], isAccurate: false };
      const data = (await res.json()) as {
        chapters?: { title?: string; startOffsetSec?: number; lengthMs?: number }[];
        isAccurate?: boolean;
      };
      const chapters: ProviderChapter[] = (data.chapters ?? [])
        .map((chapter) => ({
          title: chapter.title?.trim() ?? "",
          startOffsetSec: typeof chapter.startOffsetSec === "number" ? chapter.startOffsetSec : undefined,
          lengthSec: typeof chapter.lengthMs === "number" ? Math.round(chapter.lengthMs / 1000) : undefined,
        }))
        .filter((chapter) => chapter.title.length > 0);
      return { chapters, isAccurate: data.isAccurate ?? false };
    } catch {
      return { chapters: [], isAccurate: false };
    }
  }

  /**
   * Audnexus returns a per-author `similar` array — other authors Audible
   * associates with this one. Author-level, not book-level, which is why the
   * recommendation engine (ADR 010) treats it as one signal among several.
   * The real endpoint is /authors?name=..., not a book search.
   */
  async similarAuthors(query: EnrichmentQuery): Promise<string[]> {
    if (!query.author) return [];
    const params = new URLSearchParams({ name: query.author, region: this.region });
    try {
      const res = await fetch(`${BASE}/authors?${params.toString()}`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) return [];
      const authors = (await res.json()) as AudnexusAuthor[];
      return (authors[0]?.similar ?? [])
        .map((entry) => entry.name?.trim())
        .filter((name): name is string => Boolean(name));
    } catch {
      return [];
    }
  }
}

/**
 * Pull an Audible ASIN out of free text.
 *
 * Audible rips routinely carry the ASIN in the filename, and it is the only key
 * the free Audnexus API accepts. An ASIN is 10 characters -- 'B' plus 9
 * alphanumerics -- so a false positive is unlikely; the uppercase-only match
 * keeps it to the canonical form rips actually use.
 */
export function extractAsin(text: string | null | undefined): string | undefined {
  if (!text) return undefined;
  const match = text.match(/\b(B[A-Z0-9]{9})\b/);
  return match ? match[1] : undefined;
}
