/**
 * Spec 16 — shared types for the metadata provider chain.
 *
 * Every provider returns the same shape so `chain.ts` can walk them
 * uniformly and so applying a candidate never has to branch on provider.
 */

/** Provider identity. `chain.ts` orders these; nothing else should. */
export type ProviderId = "librivox" | "audnexus" | "googlebooks" | "openlibrary";

export const PROVIDER_IDS: ProviderId[] = ["librivox", "audnexus", "googlebooks", "openlibrary"];

/**
 * An official chapter title from a provider.
 *
 * `fileName` is the audio file the chapter corresponds to. LibriVox puts the
 * real filename in each section's `listen_url`, which lets a section be matched
 * to a track by identity rather than by position -- important because
 * positional matching silently mislabels chapters whenever a book is
 * re-encoded or a file is added.
 */
export interface ProviderChapter {
  title: string;
  fileName?: string;
  startOffsetSec?: number;
  lengthSec?: number;
}

/** Fields a provider can supply. Every one is optional — providers differ. */
export interface ProviderCandidate {
  source: ProviderId;
  /** Stable id within the provider (ASIN, LibriVox project id). Used for dedupe. */
  providerKey?: string;
  title: string;
  author?: string;
  /** Some books have several narrators; some have none. */
  narrators?: string[];
  seriesName?: string;
  /** Fractional so 0.5 / 2.5 (insertions) sort correctly. */
  seriesPosition?: number;
  publisher?: string;
  publishedYear?: number;
  language?: string;
  isbn?: string;
  /** Raw provider genre strings, before taxonomy mapping (spec 17). */
  genres?: string[];
  coverUrl?: string;
  description?: string;
  /** Official chapter titles, when the provider has them (spec 21). */
  chapters?: ProviderChapter[];
  /** 0-1. Title-and-author agreement, computed by the provider via `similarity`. */
  confidence: number;
  /** Untouched provider response, kept for debugging (spec 07). */
  raw?: unknown;
}

/** What the chain needs to know about an item to search for it. */
export interface EnrichmentQuery {
  title: string;
  author?: string;
  /** Free text from embedded tags/path used for LibriVox-vs-commercial detection. */
  hintText?: string;
  filePath?: string;
  /** Audible ASIN, when the file carries one. The only key Audnexus accepts. */
  asin?: string;
  /** Skip the "Unknown author" sentinel the scanner writes. */
  authorIsUnknown?: boolean;
}

export interface MetadataProvider {
  id: ProviderId;
  /** Providers that can supply narrators/series are ordered first by the chain. */
  supportsRichFields: boolean;
  /** Returns [] rather than throwing when the provider is unreachable. */
  search(query: EnrichmentQuery): Promise<ProviderCandidate[]>;
}

/**
 * Normalise a string for comparison: lowercase, strip punctuation, collapse
 * whitespace. Shared by provider clients and the dedupe logic in spec 19.
 */
export function normalizeText(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Title/author agreement, 0-1.
 *
 * Extracted from spec 07's private `similarity` so provider clients and the
 * chain share one implementation. Title similarity dominates; author agreement
 * is a multiplicative bonus, so a matching author can rescue a subtitle
 * mismatch but never paper over a completely different book.
 */
export function similarity(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.8;
  const aWords = new Set(na.split(" "));
  const overlap = nb.split(" ").filter((word) => aWords.has(word)).length;
  return Math.min(1, overlap / Math.max(aWords.size, nb.split(" ").length));
}

/**
 * Combine title and author agreement into one confidence.
 *
 * Author is a bonus rather than a hard requirement because audiobook metadata
 * is frequently wrong about one of the two: LibriVox credits a reader/author
 * differently from Audible, and Open Library is worse. Requiring both would
 * discard a lot of correct matches.
 */
export function scoreMatch(query: EnrichmentQuery, title: string, author?: string): number {
  const titleScore = similarity(query.title, title);
  if (titleScore === 0) return 0;
  if (!query.author || query.authorIsUnknown || !author) return titleScore;
  const authorScore = similarity(query.author, author);
  // Exact/near author match nudges up but never exceeds 1.
  return Math.min(1, titleScore * (0.85 + 0.15 * authorScore));
}

/**
 * Trim a provider description to a length the UI can render, without cutting
 * mid-word. Spec 07 required this; spec 07 never implemented it.
 */
export function trimDescription(description: string | null | undefined, maxLength = 600): string | undefined {
  if (!description) return undefined;
  const collapsed = description.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLength) return collapsed;
  const cut = collapsed.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}