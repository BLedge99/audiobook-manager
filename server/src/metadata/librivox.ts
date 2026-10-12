import {
  scoreMatch,
  trimDescription,
  type EnrichmentQuery,
  type MetadataProvider,
  type ProviderCandidate,
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

const BASE = "https://librivox.org/api/feed/audiobooks";

interface LibrivoxPerson {
  first_name?: string;
  last_name?: string;
  name?: string;
}

interface LibrivoxSection {
  title?: string;
  playtime?: number;
  listen_url?: string;
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
    confidence: scoreMatch(query, title, authors[0]),
    raw: book,
  };
}

export class LibrivoxProvider implements MetadataProvider {
  id = "librivox" as const;
  supportsRichFields = true;

  constructor(private timeoutMs = 10_000) {}

  async search(query: EnrichmentQuery): Promise<ProviderCandidate[]> {
    const params = new URLSearchParams({
      title: query.title,
      format: "json",
      extended: "1",
      ...(query.author && !query.authorIsUnknown ? { author: query.author } : {}),
    });

    let books: LibrivoxBook[];
    try {
      const res = await fetch(`${BASE}?${params.toString()}`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { books?: LibrivoxBook[] };
      books = data.books ?? [];
    } catch {
      // A provider being unreachable must never fail the item (spec 16 AC).
      return [];
    }

    return books
      .map((book) => mapLibrivoxBook(book, query))
      .filter((candidate): candidate is ProviderCandidate => candidate !== null)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);
  }
}