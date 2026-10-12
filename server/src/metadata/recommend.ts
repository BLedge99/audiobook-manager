import { normalizeText } from "./types";

/**
 * Spec 19 / ADR 010 — recommendation seeds, ranking and dedupe.
 *
 * No free service offers a genuine "audiobooks like this one" endpoint, so
 * similarity is built from what providers *do* expose: genres, authors,
 * narrators and series. That makes it tag-similarity, not a learned
 * recommender, and the UI must not imply otherwise.
 *
 * All pure: the caller supplies the candidate pool and the owned-library
 * titles, and this module decides what to surface.
 */

/**
 * Weights, declared once so the ranking is auditable and testable.
 *
 * Genre is the strongest signal because it is the only one every provider
 * agrees on. Author and series are strong but narrow (they mostly return the
 * same author). Narrator is a deliberate niche signal: plenty of listeners
 * follow a narrator, and it is the one axis book-level services model badly.
 */
export const RECOMMENDATION_WEIGHTS = {
  genre: 1.0,
  author: 0.8,
  narrator: 0.55,
  series: 0.7,
  customTag: 0.45,
} as const;

export interface Taggable {
  title: string;
  author?: string | null;
  narrators?: string[];
  seriesName?: string | null;
  genres?: string[];
  customTags?: string[];
}

export interface SeedProfile {
  genres: Map<string, number>;
  authors: Map<string, number>;
  narrators: Map<string, number>;
  series: Map<string, number>;
  customTags: Map<string, number>;
  /** How many books contributed. A single book is a thin basis. */
  sources: number;
}

function bump(map: Map<string, number>, value: string | null | undefined, weight = 1): void {
  const key = normalizeText(value);
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + weight);
}

/**
 * Extract a weighted seed profile from one or more books.
 *
 * Multi-book seeds (the favourites union) weight each tag by how many books
 * share it, so a genre common to four favourites outranks one appearing once.
 */
export function buildSeed(items: Taggable[]): SeedProfile {
  const seed: SeedProfile = {
    genres: new Map(),
    authors: new Map(),
    narrators: new Map(),
    series: new Map(),
    customTags: new Map(),
    sources: items.length,
  };

  for (const item of items) {
    bump(seed.authors, item.author, RECOMMENDATION_WEIGHTS.author);
    bump(seed.series, item.seriesName, RECOMMENDATION_WEIGHTS.series);
    for (const genre of item.genres ?? []) bump(seed.genres, genre);
    for (const narrator of item.narrators ?? []) bump(seed.narrators, narrator, RECOMMENDATION_WEIGHTS.narrator);
    for (const tag of item.customTags ?? []) bump(seed.customTags, tag, RECOMMENDATION_WEIGHTS.customTag);
  }

  return seed;
}

/**
 * Score one candidate against the seed profile. 0 means "no shared signal".
 *
 * Each dimension is the tag's share-of-books (how widely it is shared across
 * the seed set) times the dimension weight, then summed.
 */
export function scoreCandidate(candidate: Taggable, seed: SeedProfile): number {
  const dimension = (map: Map<string, number>, values: string[], weight: number): number => {
    const divisor = Math.max(1, seed.sources);
    let total = 0;
    for (const value of values ?? []) {
      const key = normalizeText(value);
      if (!key) continue;
      const shared = map.get(key);
      if (shared) total += (shared / divisor) * weight;
    }
    return Math.min(1, total);
  };

  const genreScore = dimension(seed.genres, candidate.genres ?? [], RECOMMENDATION_WEIGHTS.genre);
  const authorScore = dimension(seed.authors, [candidate.author ?? ""], RECOMMENDATION_WEIGHTS.author);
  const narratorScore = dimension(seed.narrators, candidate.narrators ?? [], RECOMMENDATION_WEIGHTS.narrator);
  const seriesScore = dimension(seed.series, [candidate.seriesName ?? ""], RECOMMENDATION_WEIGHTS.series);
  const tagScore = dimension(seed.customTags, candidate.customTags ?? [], RECOMMENDATION_WEIGHTS.customTag);

  return genreScore + authorScore + narratorScore + seriesScore + tagScore;
}

/**
 * The identity used to decide "do we already own this?".
 *
 * Compared case-, punctuation- and whitespace-insensitively, and on
 * title+author together so two different books sharing a title are not
 * conflated.
 */
export function ownedIdentity(title: string, author?: string | null): string {
  return `${normalizeText(title)}::${normalizeText(author ?? "")}`;
}

export interface RankedCandidate<T extends Taggable> {
  candidate: T;
  score: number;
  identity: string;
}

export interface RankOptions {
  /** Identities of books already in the library. Hard-excluded. */
  ownedIdentities?: Set<string>;
  limit?: number;
  /** Candidates scoring below this are dropped as noise. */
  minScore?: number;
}

/**
 * Rank candidates by similarity, hard-excluding anything already owned.
 *
 * Dedupe is by identity, and also collapses duplicate `providerKey`s so a
 * provider returning the same book across several queries yields one result.
 */
export function rankCandidates<T extends Taggable>(
  candidates: T[],
  seed: SeedProfile,
  options: RankOptions = {},
): RankedCandidate<T>[] {
  const owned = options.ownedIdentities ?? new Set<string>();
  const limit = options.limit ?? 20;
  const minScore = options.minScore ?? 0.2;

  const seen = new Set<string>();
  const scored: RankedCandidate<T>[] = [];

  for (const candidate of candidates) {
    if (!candidate.title?.trim()) continue;

    const identity = ownedIdentity(candidate.title, candidate.author);
    // Already in the library: never recommend it (ADR 010 hard dedupe).
    if (owned.has(identity)) continue;
    if (seen.has(identity)) continue;
    seen.add(identity);

    const score = scoreCandidate(candidate, seed);
    if (score < minScore) continue;
    scored.push({ candidate, score, identity });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/**
 * Is there enough signal to recommend anything at all?
 *
 * Recommending from an un-enriched library produces noise dressed up as
 * insight, so the caller must be able to say "not enough metadata yet"
 * (spec 19 acceptance criteria).
 */
export function hasEnoughSignal(seed: SeedProfile, minDistinctSeeds = 2): boolean {
  const distinct = [seed.genres, seed.authors, seed.narrators, seed.series, seed.customTags].reduce(
    (total, map) => total + map.size,
    0,
  );
  return distinct >= minDistinctSeeds;
}

/**
 * Build the set of identities the library already owns.
 *
 * Normalised so a provider returning "The Hobbit" cannot be recommended for an
 * owned "the hobbit".
 */
export function buildOwnedIdentities(owned: { title: string; author?: string | null }[]): Set<string> {
  return new Set(owned.map((item) => ownedIdentity(item.title, item.author)));
}

/**
 * Search terms to send to a provider for a seed profile, most distinctive
 * first. Providers are query-limited, so the strongest signal leads.
 */
export function searchTermsFor(seed: SeedProfile, max = 3): string[] {
  const rank = (map: Map<string, number>) => [...map.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key);
  return [...rank(seed.genres), ...rank(seed.authors), ...rank(seed.series)].slice(0, max);
}