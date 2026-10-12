import {
  scoreMatch,
  trimDescription,
  type EnrichmentQuery,
  type MetadataProvider,
  type ProviderCandidate,
} from "./types";

/**
 * Spec 16 — Audnexus provider.
 *
 * Free, no auth, no hard quota on the public instance. The best audiobook
 * metadata available for free: narrators, series + sequence, publisher, ASIN,
 * parent and sub-genres, and covers up to 3200x3200.
 *
 * Aggregates Audible's *commercial* catalogue, so it has no entry for a
 * LibriVox recording of a public-domain title (ADR 008). The chain resolves it
 * first only for commercial-audiobook-shaped items.
 */

const BASE = "https://audnex.us";

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
    // Audnexus title search accepts `author` to disambiguate. Only send it
    // when we trust it — a wrong embedded author degrades the query.
    const params = new URLSearchParams({ title: query.title });
    if (query.author && !query.authorIsUnknown) {
      params.set("author", query.author);
    }
    params.set("num_results", "10");

    let books: AudnexusBook[];
    try {
      const res = await fetch(`${BASE}/books?${params.toString()}&region=${this.region}`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { results?: AudnexusBook[] };
      books = data.results ?? [];
    } catch {
      // Unreachable provider must not fail the item (spec 16 AC).
      return [];
    }

    return books
      .map((book) => mapAudnexusBook(book, query))
      .filter((candidate): candidate is ProviderCandidate => candidate !== null)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);
  }

  /**
   * Audnexus returns a per-author `similar` array — other authors Audible
   * associates with this one. Author-level, not book-level, which is why the
   * recommendation engine (ADR 010) treats it as one signal among several.
   */
  async similarAuthors(query: EnrichmentQuery): Promise<string[]> {
    if (!query.author) return [];
    const params = new URLSearchParams({ author: query.author, "num_results": "1" });
    try {
      const res = await fetch(`${BASE}/books?${params.toString()}&region=${this.region}`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { results?: AudnexusBook[] };
      const author = data.results?.[0]?.authors?.[0];
      return (author?.similar ?? []).map((entry) => entry.name?.trim()).filter((name): name is string => Boolean(name));
    } catch {
      return [];
    }
  }
}