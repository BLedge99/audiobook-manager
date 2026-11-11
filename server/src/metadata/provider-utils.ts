/**
 * Shared, pure helpers for the provider clients.
 *
 * The catalogue responses from Open Library and Google Books are both messy
 * free text; these normalisers and guards are the ones both clients need.
 * Nothing here does I/O.
 */
import type { ProviderCandidate } from "./types";

/** Fields for a candidate, with `title` always required. */
export type MappedFields = Partial<ProviderCandidate> & { title: string; workKey?: string };

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
 * Open Library merges every edition of a work, so `language` arrives as the
 * set of languages the book was ever published in ("gre", "urd", "arm",
 * "vie"). Taking the first would file Harry Potter under Greek. Take the most
 * frequent, which is the dominant edition language, and only accept a real
 * language code.
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

export function firstString(raw: unknown): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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
