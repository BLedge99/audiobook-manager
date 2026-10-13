import path from "node:path";
import { trimDescription } from "./metadata/types";

/** Mapped fields, with `title` always required so it survives the spread. */
type MappedFields = Partial<EnrichmentCandidate> & { title: string };

export interface EnrichmentCandidate {
  source: "openlibrary" | "googlebooks";
  title: string;
  author?: string;
  coverUrl?: string;
  description?: string;
  confidence: number;
  raw: unknown;
  // --- Spec 25: fields the providers already return but spec 07 never read ---
  genres?: string[];
  publisher?: string;
  publishedYear?: number;
  isbn?: string;
  language?: string;
  seriesName?: string;
  seriesPosition?: number;
  /** Open Library work key, so a description can be fetched only if needed. */
  workKey?: string;
}

/**
 * Is this subject string obviously not a genre?
 *
 * Open Library merges every edition's subject headings from every library that
 * catalogued the work, so a single Harry Potter volume returned, among ~60 real
 * headings: `nyt:childrens-middle-grade-hardcover=2020-11-29`,
 * `series:Harry_Potter`, `Quill Award winner`, and the Spanish, German and
 * Hungarian translations of "magic". Filtering the obviously non-genre strings
 * here means the taxonomy mapping stays precision-first, rather than trying to
 * decide "is `ron` a genre?" later.
 */
export function isJunkSubject(value: string): boolean {
  const text = value.trim().toLowerCase();
  if (text.length < 4) return true;
  // Machine tags and slugs: "nyt:...", "series:Harry_Potter", anything with
  // an "=" or a scheme-like colon.
  if (/[=]/.test(text)) return true;
  if (/^[a-z]+:/.test(text)) return true;
  if (/https?:/.test(text)) return true;
  // Award and bestseller headings are marketing, not genre.
  if (/\baward\b|\bbestseller\b|\bbest seller\b|\baward winner\b/.test(text)) return true;
  // Publisher/catalogue boilerplate.
  if (/^\s*(new york times reviewed)\s*$/.test(text)) return true;
  return false;
}

/**
 * Open Library `subject` strings are messy free text:
 *   "Wizards -- Juvenile fiction", "Harry Potter (Fictitious character) -- Fiction"
 * Keep the most specific head and drop the qualifiers, which describe the
 * character or the audience rather than the genre.
 */
export function normalizeSubjects(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const head = entry.split(" -- ")[0];
    const cleaned = head
      .replace(/\([^)]*\)/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned.length < 3 || cleaned.length > 60) continue;
    if (isJunkSubject(cleaned)) continue;
    if (!out.some((value) => value.toLowerCase() === cleaned.toLowerCase())) out.push(cleaned);
  }
  return out;
}

/**
 * Open Library merges every edition of a work, so `language` arrives as the set
 * of languages the book was ever published in ("gre", "urd", "arm", "vie").
 * Taking the first would file Harry Potter under Greek. Take the most frequent,
 * which is the dominant edition language, and only accept a real language code.
 */
export function pickLanguage(raw: unknown): string | undefined {
  const values = Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
  if (values.length === 0) return typeof raw === "string" ? raw : undefined;
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value.toLowerCase(), (counts.get(value.toLowerCase()) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [top, runnerUp] = ranked;
  // Require a strict winner. With four editions in four different languages
  // there is no signal at all, and guessing "gre" over "eng" would file an
  // English audiobook under Greek -- worse than leaving it empty.
  if (!top || (runnerUp && top[1] === runnerUp[1])) return undefined;
  return /^[a-z]{2,3}$/.test(top[0]) ? top[0] : undefined;
}

/**
 * Series position as a number, or undefined when it is not usable.
 *
 * Rejects non-numeric values and anything <= 0: a book at "position 0" is not
 * in a series, it is an interstitial or a data error.
 */
export function parseSeriesPosition(raw: unknown): number | undefined {
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first === "number" && Number.isFinite(first) && first > 0) return first;
  if (typeof first === "string") {
    const parsed = Number.parseFloat(first);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function firstString(raw: unknown): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

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

/** Fields for a candidate, from a Google Books `volumeInfo`. */
export function mapGoogleVolume(info: Record<string, unknown>): MappedFields {
  const identifiers = Array.isArray(info.industryIdentifiers) ? info.industryIdentifiers : [];
  const isbn = identifiers.find(
    (entry): entry is { type?: string; identifier?: string } =>
      typeof entry === "object" && entry !== null && /isbn/i.test(String((entry as { type?: string }).type)),
  )?.identifier;

  const published = typeof info.publishedDate === "string" ? Number.parseInt(info.publishedDate, 10) : NaN;
  const maxYear = new Date().getFullYear() + 1;
  const imageLinks = info.imageLinks as { thumbnail?: string } | undefined;

  return {
    title: String(info.title ?? "Unknown"),
    author: firstString(info.authors),
    coverUrl: imageLinks?.thumbnail?.replace(/^http:/, "https:"),
    description: typeof info.description === "string" ? info.description : undefined,
    publisher: firstString(info.publisher),
    isbn: typeof isbn === "string" ? isbn : undefined,
    language: pickLanguage(info.language),
    publishedYear: Number.isFinite(published) && published > 1400 && published <= maxYear ? published : undefined,
    // Google Books categories are BISAC-ish strings like "Juvenile Fiction".
    genres: normalizeSubjects(info.categories),
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

function similarity(a: string, b: string): number {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.8;
  const aWords = new Set(na.split(" "));
  const overlap = nb.split(" ").filter((word) => aWords.has(word)).length;
  return Math.min(1, overlap / Math.max(aWords.size, nb.split(" ").length));
}

/**
 * Titles that are not the book itself.
 *
 * Open Library indexes the AI-generated study-guide spam that dominates Amazon
 * for popular series. Searching "Harry Potter and the Deathly Hallows" returned
 * "Summary of Harry Potter and the Deathly Hallows" (Bookhabits) and
 * "Conversations on Harry Potter and the Deathly Hallows" (Daily Books) as the
 * top two hits, with the actual novel absent from the top five. Those score well
 * on title similarity because the book title is contained in them, so they must
 * be refused explicitly or enrichment confidently applies the wrong work.
 */
const NON_BOOK_TITLE = /^\s*(summary of|summarised? of|study guide|stud(y|ies) guide|guide to|analysis of|conversations on|companion to|a study of|notes on|key facts|summary and analysis|book summary)\b/i;

export function isNonBookTitle(title: string | null | undefined): boolean {
  if (!title) return true;
  return NON_BOOK_TITLE.test(title.trim());
}

export async function searchOpenLibrary(title: string, _author?: string): Promise<EnrichmentCandidate[]> {
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
 * Fetch a work description from Open Library, on demand.
 *
 * Search results carry no description, and the work record is a second request
 * per book. So this is only called when nothing else supplied one -- the
 * alternative is a wasted request for every book that already has a blurb.
 */
export async function fetchOpenLibraryDescription(workKey: string | undefined): Promise<string | undefined> {
  if (!workKey || !/^\/works\/[A-Za-z0-9]+$/.test(workKey)) return undefined;
  try {
    const res = await fetch(`https://openlibrary.org${workKey}.json`);
    if (!res.ok) return undefined;
    const data = (await res.json()) as { description?: unknown };
    const value = data.description;
    // Open Library returns either a bare string or a shape carrying `value`,
    // sometimes keyed by language. `type` sorts first, so it must be skipped
    // explicitly or the description silently becomes the word "text".
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

export async function searchGoogleBooks(title: string, _author?: string): Promise<EnrichmentCandidate[]> {
  const key = process.env.GOOGLE_BOOKS_API_KEY;
  // Title only. Adding the author to the query measurably degraded results --
  // see the note on searchOpenLibrary. The author still scores the candidate.
  const query = encodeURIComponent(title);
  const url = `https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=10${key ? `&key=${key}` : ""}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = (await res.json()) as { items?: { volumeInfo?: Record<string, unknown> }[] };
  return (data.items ?? [])
    .map((item) => {
      const info = item.volumeInfo ?? {};
      const mapped = mapGoogleVolume(info);
      return {
        source: "googlebooks" as const,
        ...mapped,
        confidence: similarity(title, String(info.title ?? "")),
        raw: item,
      };
    })
    .filter((candidate) => !isNonBookTitle(candidate.title))
    .slice(0, 5);
}

export function candidateCoverFilename(source: string, id: number): string {
  return `${source}_${id}_${Date.now()}.jpg`;
}

export const COVER_DIR = process.env.COVER_DIR || "/app/data/covers";

export async function downloadCover(url: string, destPath: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    const buffer = Buffer.from(await res.arrayBuffer());
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(path.dirname(destPath), { recursive: true });
    await writeFile(destPath, buffer);
    return true;
  } catch {
    return false;
  }
}
