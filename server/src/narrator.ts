/**
 * Spec 24 — narrator resolution from local sources.
 *
 * A narrator belongs to a *recording*, not to a book. That is why no
 * free, title-searchable source carries one: Open Library and Google Books
 * catalogue the work, not the performance, and the same work has dozens of
 * recordings. Verified live against the fixture library -- not assumed.
 *
 * So the narrator is taken from what the files themselves say, in
 * most-trusted-first order:
 *
 *   1. `composer` atom   -- the Audible convention. Already worked.
 *   2. `comment` field   -- "Read By Stephen Fry", extremely common in MP3 rips.
 *   3. folder name       -- "{Stephen Fry}", "(Narrated by Stephen Fry)".
 *
 * Everything here is pure and synchronous so the matching rules are
 * unit-testable. This is deliberately a *local* resolver: it needs no network,
 * no API key and no rate limit, which means it cannot break when a provider
 * has an outage.
 */

/** Where a resolved narrator came from. Useful for provenance and tests. */
export type NarratorSource = "composer" | "comment" | "folder";

export interface ResolvedNarrator {
  names: string[];
  source: NarratorSource;
}

/**
 * Words that appear in bracketed folder names but are not people.
 *
 * This guard exists because the folder heuristic is the weakest source: a
 * folder called "{Unabridged}" or "[Retail Rip]" would otherwise be read as a
 * narrator named "Unabridged".
 */
const NOT_PERSONS = new Set([
  "unabridged",
  "abridged",
  "audiobook",
  "audio book",
  "audio",
  "book",
  "books",
  "retail",
  "retail rip",
  "full cast",
  "fullcast",
  "single narrator",
  "single narrator read",
  "complete",
  "complete unabridged",
  "rip",
  "mp3",
  "m4b",
  "m4a",
  "flac",
  "audiobooks",
  "read by",
  "narrated by",
  "the",
  "and",
]);

/** Comment-field shapes seen in real rips. */
const COMMENT_PATTERNS: RegExp[] = [
  /^\s*(?:read|narrated)\s+by\s+(.+)$/i,
  /^\s*narrator\s*[:\-]\s*(.+)$/i,
  /^\s*(?:read|narrated)\s*[:\-]\s*(.+)$/i,
];

/** Bracketed folder-name segments: "{X}", "(X)", "[X]". */
const FOLDER_BRACKETS = /[({[]([^(){}[\]]{2,60})[)}\]]/g;

/**
 * Does this look like a person's name?
 *
 * Requires at least two tokens, each starting uppercase. That is what
 * separates "Stephen Fry" from "Unabridged" or "Retail Rip", without needing an
 * exhaustive blocklist. Initials ("J. K. Rowling") pass; digits and path
 * separators do not.
 */
export function looksLikePersonName(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const cleaned = raw
    .replace(/[.,;:/\\]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 3 || cleaned.length > 60) return false;
  if (/\d/.test(cleaned)) return false;
  if (/[/\\]/.test(cleaned)) return false;
  if (NOT_PERSONS.has(cleaned.toLowerCase())) return false;

  const tokens = cleaned.split(" ").filter(Boolean);
  if (tokens.length < 2) return false;
  return tokens.every((token) => /^[A-Z0-9][\p{L}'’.-]*$/u.test(token));
}

/**
 * Split a raw narrator string into individual names.
 *
 * Multi-narrator recordings are common (a full cast reads a whole series), so
 * "Scott Brick and David Most" has to become two contributors rather than one
 * person with a very long name.
 */
export function splitNarrators(raw: string): string[] {
  return raw
    .split(/\s*(?:,|;|\/|\band\b|&|\+|\bx\b)\s*/i)
    // Strip trailing punctuation and any leading separator left behind by the
    // split -- "Read by - Stephen Fry" yields "- Stephen Fry", and the dash
    // would otherwise fail the person-name check.
    .map((entry) => entry.replace(/^[\s\-:–—]+/, "").replace(/[.,;:\-–—]+$/g, "").trim())
    .filter((entry) => entry.length > 0);
}

function pickNames(raw: string): string[] {
  const out: string[] = [];
  for (const candidate of splitNarrators(raw)) {
    if (!looksLikePersonName(candidate)) continue;
    // De-duplicate case-insensitively while preserving the first spelling.
    if (out.some((entry) => entry.toLowerCase() === candidate.toLowerCase())) continue;
    out.push(candidate);
  }
  return out;
}

/** Read a narrator out of a `comment`/`Read By` style tag. */
export function narratorFromComment(comment: string | null | undefined): string[] {
  if (!comment) return [];
  const text = comment.trim();
  for (const pattern of COMMENT_PATTERNS) {
    const match = text.match(pattern);
    if (match) return pickNames(match[1]);
  }
  return [];
}

/**
 * Read a narrator out of a folder name.
 *
 * Only bracketed segments are considered, and the "Narrated by"/"Read by"
 * prefix is stripped so both `{Stephen Fry}` and `(Narrated by Stephen Fry)`
 * resolve. Unbracketed folder names are never guessed from -- too many false
 * positives in a real library.
 */
export function narratorFromFolder(folderName: string | null | undefined): string[] {
  if (!folderName) return [];
  const out: string[] = [];
  FOLDER_BRACKETS.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FOLDER_BRACKETS.exec(folderName)) !== null) {
    let inner = match[1].trim();
    const prefixed = inner.match(/^\s*(?:read|narrated)\s+by\s+(.+)$/i);
    if (prefixed) inner = prefixed[1].trim();
    for (const name of pickNames(inner)) {
      if (!out.some((entry) => entry.toLowerCase() === name.toLowerCase())) out.push(name);
    }
  }
  return out;
}

/**
 * Resolve the narrator for one book, most-trusted source first.
 *
 * Returns null when nothing yields a name, so the caller can leave the field
 * empty and visible rather than guessing.
 */
export function resolveLocalNarrator(input: {
  composer?: string | null;
  comment?: string | null;
  folderName?: string | null;
}): ResolvedNarrator | null {
  const composer = pickNames((input.composer ?? "").trim());
  if (composer.length > 0) return { names: composer, source: "composer" };

  const comment = narratorFromComment(input.comment);
  if (comment.length > 0) return { names: comment, source: "comment" };

  const folder = narratorFromFolder(input.folderName);
  if (folder.length > 0) return { names: folder, source: "folder" };

  return null;
}