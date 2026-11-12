/**
 * Google Books provider client (spec 07 / spec 16).
 */
import { similarity, type MetadataProvider, type EnrichmentQuery, type ProviderCandidate } from "./types";
import {
  firstString,
  isNonBookTitle,
  normalizeSubjects,
  pickLanguage,
} from "./provider-utils";
import type { MappedFields } from "./provider-utils";

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
    subjectStrings: Array.isArray(info.categories)
      ? info.categories.filter((entry): entry is string => typeof entry === "string")
      : undefined,
    maturityRating: typeof info.maturityRating === "string" ? info.maturityRating : undefined,
  };
}

export async function searchGoogleBooks(title: string, _author?: string): Promise<ProviderCandidate[]> {
  const key = process.env.GOOGLE_BOOKS_API_KEY;
  // Title only. Adding the author to the query measurably degraded results --
  // see the note on searchOpenLibrary.
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

export class GoogleBooksProvider implements MetadataProvider {
  id = "googlebooks" as const;
  supportsRichFields = false;

  async search(query: EnrichmentQuery): Promise<ProviderCandidate[]> {
    return searchGoogleBooks(query.title, query.authorIsUnknown ? undefined : query.author);
  }
}
