import {
  scoreMatch,
  trimDescription,
  type EnrichmentQuery,
  type MetadataProvider,
  type ProviderCandidate,
  type ProviderChapter,
} from "./types";

/**
 * Spec 16 — LibriVox provider.
 *
 * Free, no auth, no quota. The only free source that returns per-section
 * *readers*, which for a multi-file book is more accurate than a single
 * book-level narrator string (see ADR 008).
 *
 * Blind to anything LibriVox did not produce, so the chain resolves it first
 * only when the item looks like a LibriVox recording.
 */

/**
 * Strip the decoration an archive-style folder name carries.
 *
 * LibriVox folder names are frequently archive.org identifiers
 * ("ghohor034_1907_librivox", "12_creepytales_1206_librivox"). LibriVox's API
 * does an exact title match, so the raw name finds nothing. This produces
 * plausible search titles; the chain still scores every result, so a bad
 * variant costs a request rather than producing a wrong match.
 */
export function titleVariants(title: string): string[] {
  const variants = new Set<string>();
  const trimmed = title.trim();
  if (!trimmed) return [];

  variants.add(trimmed);

  // Drop a trailing `_librivox` / `-librivox` marker.
  const withoutMarker = trimmed.replace(/[-_ ]+librivox\s*$/i, "").trim();
  if (withoutMarker) variants.add(withoutMarker);

  // Drop trailing catalog numbers: `absoluteevil_2608` -> `absoluteevil`.
  const withoutNumber = withoutMarker.replace(/[-_ ]+\d{2,}\s*$/, "").trim();
  if (withoutNumber && withoutNumber.length > 2) variants.add(withoutNumber);

  // Drop a leading catalogue number: `12_creepytales_1206` -> `creepytales`.
  const withoutLeadingNumber = withoutNumber.replace(/^\d+[-_ ]+/, "").trim();
  if (withoutLeadingNumber && withoutLeadingNumber.length > 2) variants.add(withoutLeadingNumber);

  // Underscores are separators, not word breaks, in these names.
  for (const variant of [...variants]) {
    const spaced = variant.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
    if (spaced) variants.add(spaced);
  }

  // LibriVox matches titles exactly and drops leading articles: a file tagged
  // album "The Awakening" has to be looked up as "Awakening".
  for (const variant of [...variants]) {
    const withoutArticle = variant.replace(/^(the|a|an)\s+/i, "").trim();
    if (withoutArticle && withoutArticle.length > 2) variants.add(withoutArticle);
  }

  return [...variants].filter((variant) => variant.length > 1);
}

const BASE = "https://librivox.org/api/feed/audiobooks";

interface LibrivoxPerson {
  first_name?: string;
  last_name?: string;
  name?: string;
  /**
   * Section *readers* use `display_name` only -- there is no first/last split,
   * and it can carry a life span ("Kara Shallenberg (1969-2023)").
   */
  display_name?: string;
}

interface LibrivoxSection {
  id?: string;
  section_number?: string;
  title?: string;
  playtime?: number;
  listen_url?: string;
  file_name?: string | null;
  readers?: LibrivoxPerson[];
  translators?: LibrivoxPerson[];
}

interface LibrivoxBook {
  id?: string;
  title?: string;
  description?: string;
  url_librivox?: string;
  language?: string;
  copyright_year?: number;
  num_sections?: number;
  totalthemes?: string;
  authors?: LibrivoxPerson[];
  translators?: LibrivoxPerson[];
  genres?: LibrivoxPerson[];
  sections?: LibrivoxSection[];
}

function personName(person: LibrivoxPerson | undefined): string | undefined {
  if (!person) return undefined;
  if (person.name) return person.name;
  if (person.display_name) {
    // "Kara Shallenberg (1969-2023)" -> "Kara Shallenberg". The life span is
    // useful in a search index but is not a name.
    const withoutDates = person.display_name.replace(/\s*\((?:[^)]*\d{4}[^)]*)\)\s*$/, "").trim();
    return withoutDates || person.display_name.trim();
  }
  const joined = [person.first_name, person.last_name].filter(Boolean).join(" ").trim();
  return joined || undefined;
}

function personNames(people: LibrivoxPerson[] | undefined): string[] {
  if (!people) return [];
  return people.map(personName).filter((name): name is string => Boolean(name));
}

/** Distinct, order-preserving, case-insensitive. */
function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(value);
    }
  }
  return out;
}

/**
 * Map LibriVox sections to chapter titles.
 *
 * `listen_url` carries the real audio filename, which lets a section be tied to
 * a specific track by identity instead of by position. `file_name` is usually
 * null in the API, so `listen_url` is the reliable signal.
 */
export function mapLibrivoxSections(sections: LibrivoxSection[] = []): ProviderChapter[] {
  const chapters: ProviderChapter[] = [];
  for (const section of sections) {
    const title = section.title?.trim();
    if (!title) continue;
    const fromListenUrl = section.listen_url ? basename(section.listen_url) : undefined;
    const fileName = section.file_name?.trim() || fromListenUrl;
    chapters.push({
      title,
      fileName: fileName || undefined,
      lengthSec: typeof section.playtime === "number" ? section.playtime : undefined,
    });
  }
  return chapters;
}

function basename(url: string): string {
  const withoutQuery = url.split(/[?#]/)[0];
  const parts = withoutQuery.split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : "";
}

export function mapLibrivoxBook(book: LibrivoxBook, query: EnrichmentQuery): ProviderCandidate | null {
  const title = book.title?.trim();
  if (!title) return null;

  const authors = dedupe(personNames(book.authors));
  const translators = dedupe(personNames(book.translators));

  // Narrators: book-level readers if present, else fall back to the union of
  // section readers. Multi-file books almost always carry them per-section.
  const bookReaders = dedupe((book.sections ?? []).flatMap((section) => personNames(section.readers)));
  const narrators = bookReaders;

  // Translators are contributors in their own right (spec 17); carry them in
  // the raw payload and let the applier turn them into Contributor rows.
  if (translators.length > 0) {
    (book as LibrivoxBook).translators = translators.map((name) => ({ name }));
  }

  return {
    source: "librivox",
    providerKey: book.id ? String(book.id) : undefined,
    title,
    author: authors[0],
    narrators,
    publisher: "LibriVox",
    publishedYear: typeof book.copyright_year === "number" ? book.copyright_year : undefined,
    language: book.language,
    genres: dedupe(personNames(book.genres)),
    description: trimDescription(book.description),
    chapters: mapLibrivoxSections(book.sections),
    confidence: scoreMatch(query, title, authors[0]),
    raw: book,
  };
}

export class LibrivoxProvider implements MetadataProvider {
  id = "librivox" as const;
  supportsRichFields = true;

  constructor(private timeoutMs = 10_000) {}

  async search(query: EnrichmentQuery): Promise<ProviderCandidate[]> {
    // NOTE: `author` is deliberately never sent alongside `title`. The LibriVox
    // API returns HTTP 500 for the combination, which silently produced zero
    // candidates for every book until a live run against the real API caught
    // it. The author is still used, but locally in `scoreMatch`.
    //
    // LibriVox also does an *exact* title match, so a folder-derived title
    // ("ghohor034_1907_librivox") finds nothing. Try each plausible variant in
    // turn and stop at the first that returns results.
    const collected: LibrivoxBook[] = [];
    const seenIds = new Set<string>();

    for (const variant of titleVariants(query.title)) {
      const params = new URLSearchParams({ title: variant, format: "json", extended: "1" });
      try {
        const res = await fetch(`${BASE}?${params.toString()}`, {
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        // 404 means "no such title" -- that is a normal miss, not a failure.
        if (!res.ok) continue;
        const data = (await res.json()) as { books?: LibrivoxBook[] };
        const books = data.books ?? [];
        if (books.length === 0) continue;
        for (const book of books) {
          const key = book.id ? String(book.id) : `${book.title}`;
          if (seenIds.has(key)) continue;
          seenIds.add(key);
          collected.push(book);
        }
        // A variant produced results; further variants would only add noise.
        break;
      } catch {
        // A provider being unreachable must never fail the item (spec 16 AC).
        return [];
      }
    }

    return collected
      .map((book) => mapLibrivoxBook(book, query))
      .filter((candidate): candidate is ProviderCandidate => candidate !== null)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);
  }
}