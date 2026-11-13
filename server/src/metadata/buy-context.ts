/**
 * The "Free" row's one server-side lookup (spec 39 / ADR 034).
 *
 * librivox.org sends no CORS header, so the client cannot call it directly;
 * without this endpoint the Free row simply cannot exist. Everything here is
 * identifiers-only (title/author — not personal data), never logged, never
 * persisted; results are cached in memory for five minutes.
 *
 * Why author=, not title=: LibriVox's title= filter is exact or
 * `^`-anchored, and store titles often drop the leading article ("The
 * Picture of Dorian Gray" is catalogued as "Picture of Dorian Gray"). The
 * author= query is forgiving (`author=Wilde` matches), and the title
 * comparison happens locally against the small result set.
 *
 * Failure never surfaces as a 5xx: every error path returns null and the
 * sheet renders without the Free row.
 */

import { normalizeText, similarity } from "./types";

const BASE = "https://librivox.org/api/feed/audiobooks";
const CACHE_TTL_MS = 5 * 60 * 1000;
const DEADLINE_MS = 8000;
/** A match needs most title tokens to overlap and the author's last name present. */
const TITLE_MATCH_FLOOR = 0.85;
/** Enough distinct store titles to cover a household's Discover usage; expired entries are dropped on write. */
const CACHE_MAX_ENTRIES = 200;

export interface LibrivoxMatch {
  id: string;
  title: string;
  url: string;
}

export interface BuyContextLookup {
  librivox: LibrivoxMatch | null;
}

interface CacheEntry {
  at: number;
  match: LibrivoxMatch | null;
}

const cache = new Map<string, CacheEntry>();

/** Test seam: empty the in-memory cache. */
export function clearBuyContextCache(): void {
  cache.clear();
}

/** "The Picture of Dorian Gray!" → "picture of dorian gray". */
export function normaliseLookupTitle(title: string): string {
  return normalizeText(title).replace(/^(the|a|an)\s+/, "").trim();
}

/**
 * The last word of the RAW author, edge punctuation stripped — sent to
 * LibriVox as-is (its author= filter matches family-name spelling; store it
 * with its own capitalisation, e.g. "Wilde").
 */
export function lastAuthorToken(author: string | undefined): string | undefined {
  if (!author) return undefined;
  const token = author.trim().split(/\s+/).pop();
  if (!token) return undefined;
  const cleaned = token.replace(/^[^A-Za-zÀ-ÖØ-öø-ÿ]+|[^A-Za-zÀ-ÖØ-öø-ÿ]+$/g, "");
  return cleaned.length >= 2 ? cleaned : undefined;
}

interface LibrivoxPage {
  books?: Array<{
    id?: string | number;
    title?: string;
    url_librivox?: string;
    url_rss?: string;
  }>;
}

function cacheKey(title: string, author: string): string {
  return `${normaliseLookupTitle(title)} ${normalizeText(author)}`;
}

/** Name blobs out of the author representations LibriVox uses (array of objects, array of strings, or a bare string). */
function authorBlobs(book: unknown): string[] {
  const raw = (book as Record<string, unknown>).authors ?? (book as Record<string, unknown>).author;
  if (typeof raw === "string") return [raw];
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object") {
        const name = [
          (entry as Record<string, unknown>).first_name,
          (entry as Record<string, unknown>).last_name,
        ]
          .filter((part): part is string => typeof part === "string" && part.length > 0)
          .join(" ");
        return name;
      }
      return "";
    })
    .filter((blob) => blob.length > 0);
}

function authorAgrees(book: unknown, authorToken: string): boolean {
  const needle = normalizeText(authorToken);
  return authorBlobs(book).some((blob) => normalizeText(blob).includes(needle));
}

export async function findLibrivoxMatch(input: {
  title: string;
  author?: string;
}): Promise<LibrivoxMatch | null> {
  const authorToken = lastAuthorToken(input.author);
  if (!authorToken || !input.title.trim()) return null;

  const key = cacheKey(input.title, input.author ?? "");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.match;
  }
  if (hit) cache.delete(key);

  const params = new URLSearchParams({
    format: "json",
    extended: "1",
    author: authorToken,
    fields: "id,title,authors,url_librivox,url_rss",
    limit: "20",
  });

  let match: LibrivoxMatch | null = null;
  try {
    const response = await fetch(`${BASE}?${params.toString()}`, {
      signal: AbortSignal.timeout(DEADLINE_MS),
    });
    if (response.ok) {
      const body = (await response.json()) as LibrivoxPage;
      const wanted = normaliseLookupTitle(input.title);
      for (const book of body.books ?? []) {
        const url = typeof book.url_librivox === "string" && book.url_librivox
          ? book.url_librivox
          : typeof book.url_rss === "string" && book.url_rss
            ? book.url_rss
            : null;
        if (!url || typeof book.title !== "string" || book.id === undefined) continue;
        const candidateTitle = normaliseLookupTitle(book.title);
        const titleScore = similarity(wanted, candidateTitle);
        if (titleScore < TITLE_MATCH_FLOOR) continue;
        if (!authorAgrees(book, authorToken)) continue;
        match = { id: String(book.id), title: book.title, url };
        break;
      }
    }
  } catch {
    match = null;
  }

  // Drop expired entries first, then the oldest-inserted, so a storefront
  // that scrolls everything cannot grow the map without bound.
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (now - v.at >= CACHE_TTL_MS) cache.delete(k);
    }
    while (cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next();
      if (oldest.done) break;
      cache.delete(oldest.value);
    }
  }
  cache.set(key, { at: Date.now(), match });
  return match;
}
