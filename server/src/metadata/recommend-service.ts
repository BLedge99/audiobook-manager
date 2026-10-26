import type { PrismaClient } from "@prisma/client";
import { searchOpenLibraryBySubject } from "../enrichment";
import {
  buildOwnedIdentities,
  buildSeed,
  hasEnoughSignal,
  rankCandidates,
  type Taggable,
} from "./recommend";
import { trimDescription, type ProviderCandidate } from "./types";

/**
 * Spec 19 — the recommendation service.
 *
 * Expands a seed profile through the providers, then hands the pool to the
 * pure ranking module (ADR 010). Keeps the "no free similar-books API" reality
 * in one place rather than scattered through the route.
 */

/** Why a recommendation was offered. The client owns the words. */
export type RecommendationReason =
  | { code: "shared-genre"; genre: string }
  | { code: "favourite-author"; author: string }
  | { code: "series"; series: string }
  | { code: "related" };

/** A non-ok Discover status, as a code the client renders. */
export type DiscoverMessageCode =
  | "seed-needs-details"
  | "favourites-need-details"
  | "favourites-not-enough-metadata"
  | "no-similar-books"
  | "no-new-books";

export interface DiscoverMessage {
  code: DiscoverMessageCode;
}

/** A recommendation as the API returns it. Never includes a playable URL. */
export interface Recommendation {
  title: string;
  author?: string;
  narrators: string[];
  description?: string;
  coverUrl?: string;
  genres: string[];
  seriesName?: string;
  publisher?: string;
  publishedYear?: number;
  provider: string;
  providerKey?: string;
  score: number;
  reason: RecommendationReason;
}

export type DiscoverStatus = "ok" | "offline" | "insufficient-metadata" | "no-results";

export interface DiscoverResult {
  status: DiscoverStatus;
  recommendations: Recommendation[];
  /** Present when status is not ok, so the UI can explain itself. */
  message?: DiscoverMessage;
  /** The tags the recommendations were drawn from, for transparency. */
  seededFrom?: {
    genres: string[];
    authors: string[];
    series: string[];
    bookCount: number;
  };
  /** 1-based page of results, for the "Show more" control. */
  page: number;
  pageSize: number;
  /** Whether another page exists. Drives the button's presence. */
  hasMore: boolean;
  /** How many ranked results exist in total, not just on this page. */
  total: number;
  seedTitle?: string;
}

/** Suggestions shown at once, per the spec 15b acceptance criteria. */
export const DEFAULT_PAGE_SIZE = 5;

/**
 * How much of Open Library a seed pulls in before ranking.
 *
 * Two pages of 50 per subject, for up to three subjects. The number matters
 * because of *how* the result is used: the pool is ranked once and then sliced
 * into pages, so a deeper pool means the second page is a continuation of the
 * same ranking rather than a fresh random draw. Six requests is the ceiling on a
 * cold seed, issued in parallel, cached for 30 minutes, and the server
 * identifies itself so Open Library grants 3x the rate limit.
 */
const POOL_PAGES = 2;
const POOL_PAGE_SIZE = 50;

/**
 * How many ranked results exist before paging begins.
 *
 * The pool is ranked *in full* and then sliced, so this is the ceiling on how
 * many pages the button can ever offer. Ranking five at a time and re-ranking for
 * the next five would produce a second page that disagrees with the first --
 * which is the "results at random" complaint restated.
 */
const RANK_LIMIT = 100;

function toTaggable(candidate: ProviderCandidate): Taggable {
  return {
    title: candidate.title,
    author: candidate.author,
    narrators: candidate.narrators ?? [],
    seriesName: candidate.seriesName,
    seriesPosition: candidate.seriesPosition,
    genres: candidate.genres ?? [],
    publishedYear: candidate.publishedYear,
    // A record with no cover can only ever render as a placeholder, so the
    // ranker treats it as a weaker candidate rather than a full one.
    hasCover: Boolean(candidate.coverUrl),
  };
}

/** Rank, then re-attach the full provider payload to the surviving results. */
function rankWithPayload(
  pool: ProviderCandidate[],
  seed: ReturnType<typeof buildSeed>,
  owned: Set<string>,
  limit: number,
): { candidate: ProviderCandidate; score: number }[] {
  const taggables = pool.map(toTaggable);
  const ranked = rankCandidates(taggables, seed, { ownedIdentities: owned, limit });
  // rankCandidates preserves order and length, so index alignment is safe.
  return ranked.map((entry, index) => ({ candidate: pool[taggables.indexOf(entry.candidate)], score: entry.score }));
}

/** Human-readable explanation of why a result was suggested. */
function explain(candidate: Taggable, seed: ReturnType<typeof buildSeed>): RecommendationReason {
  const shared = (values: string[], map: Map<string, number>): string[] =>
    (values ?? []).filter((value) => map.has(value.trim().toLowerCase()));

  const genreHits = shared(candidate.genres ?? [], seed.genres);
  if (genreHits.length > 0) return { code: "shared-genre", genre: genreHits[0] };
  if (candidate.author && seed.authors.has(candidate.author.trim().toLowerCase())) {
    return { code: "favourite-author", author: candidate.author };
  }
  if (candidate.seriesName && seed.series.has(candidate.seriesName.trim().toLowerCase())) {
    return { code: "series", series: candidate.seriesName };
  }
  return { code: "related" };
}

export class RecommendationService {
  constructor(private prisma: PrismaClient) {}

  /** Everything the library owns, as normalised identities. */
  private async ownedIdentities(): Promise<Set<string>> {
    const owned = await this.prisma.mediaItem.findMany({ select: { title: true, author: true } });
    return buildOwnedIdentities(owned);
  }

  /**
   * Query providers for candidates matching the seed.
   *
   * Every provider failure is tolerated: one being down degrades result
   * quality rather than failing Discover entirely (spec 16's isolation rule,
   * applied here too).
   *
   * Open Library subject search is the only source here that can actually answer
   * this question. Audnexus's `search()` is a no-op without an ASIN, and LibriVox
   * matches titles exactly, so feeding it genre words returns nothing. See
   * `searchOpenLibraryBySubject` for the full reasoning.
   *
   * **Several pages are pulled and merged, because the caller ranks the merged
   * pool once and only then slices it into pages.** That is the whole point of
   * feature 3: returning one page of results per request would make "load more"
   * a fresh random draw, which is precisely the behaviour the tester reported as
   * "results at random".
   */
  private async expand(seed: ReturnType<typeof buildSeed>): Promise<ProviderCandidate[]> {
    // Subjects to browse, most distinctive first. Distinctive matters: a vague
    // subject like "fiction" returns tens of thousands of books, all of which
    // the ranking stage would then have to sift, while "horror" returns a few
    // hundred that are actually related to a household that likes Poe.
    const subjects = [...seed.genres.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([slug]) => slug);
    if (!subjects.length) return [];

    const requests: Promise<ProviderCandidate[]>[] = [];
    for (const subject of subjects) {
      for (let page = 1; page <= POOL_PAGES; page += 1) {
        requests.push(searchOpenLibraryBySubject(subject, { limit: POOL_PAGE_SIZE, page }));
      }
    }

    const results = await Promise.allSettled(requests);

    // Dedupe by provider key as they merge. The same book is returned by several
    // subjects, and without this the pool is mostly repeats of its own head.
    const byKey = new Map<string, ProviderCandidate>();
    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      for (const candidate of result.value) {
        const key = candidate.providerKey || `${candidate.title}::${candidate.author ?? ""}`;
        if (!byKey.has(key)) byKey.set(key, candidate);
      }
    }
    return [...byKey.values()];
  }

  private shape(
    pool: ProviderCandidate[],
    seed: ReturnType<typeof buildSeed>,
    owned: Set<string>,
    limit: number,
  ): Recommendation[] {
    return rankWithPayload(pool, seed, owned, limit).map(({ candidate, score }) => ({
      title: candidate.title,
      author: candidate.author,
      narrators: candidate.narrators ?? [],
      description: trimDescription(candidate.description, 300),
      coverUrl: candidate.coverUrl,
      genres: candidate.genres ?? [],
      seriesName: candidate.seriesName,
      publisher: candidate.publisher,
      publishedYear: candidate.publishedYear,
      provider: candidate.source,
      providerKey: candidate.providerKey,
      score: Number(score.toFixed(3)),
      reason: explain(toTaggable(candidate), seed),
    }));
  }

  private summarise(seed: ReturnType<typeof buildSeed>) {
    return {
      genres: [...seed.genres.keys()],
      authors: [...seed.authors.keys()],
      series: [...seed.series.keys()],
      bookCount: seed.sources,
    };
  }

  /** "Find more like this" for one owned book. */
  async similarTo(mediaItemId: number, options: { page?: number; pageSize?: number } = {}): Promise<DiscoverResult> {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;

    const item = await this.prisma.mediaItem.findUnique({
      where: { id: mediaItemId },
      include: {
        genres: { include: { genre: true } },
        contributors: { include: { contributor: true } },
        customTags: { include: { tag: true } },
        series: true,
      },
    });
    if (!item) return { status: "no-results", recommendations: [], page, pageSize, hasMore: false, total: 0 };

    const taggable: Taggable = {
      title: item.title,
      author: item.author,
      narrators: item.contributors
        .filter((link) => link.contributor.role === "narrator")
        .map((link) => link.contributor.name),
      seriesName: item.series?.name,
      seriesPosition: item.seriesPosition,
      genres: item.genres.map((row) => row.genre.slug),
      customTags: item.customTags.map((row) => row.tag.name),
      publishedYear: item.publishedYear,
      hasCover: Boolean(item.coverImagePath),
    };

    const seed = buildSeed([taggable]);
    const seededFrom = this.summarise(seed);

    if (!hasEnoughSignal(seed)) {
      return {
        status: "insufficient-metadata",
        recommendations: [],
        message: { code: "seed-needs-details" },
        seededFrom,
        seedTitle: item.title,
        page,
        pageSize,
        hasMore: false,
        total: 0,
      };
    }

    const owned = await this.ownedIdentities();
    const all = this.shape(await this.expand(seed), seed, owned, RANK_LIMIT);
    const recommendations = all.slice((page - 1) * pageSize, page * pageSize);

    return {
      status: recommendations.length > 0 ? "ok" : "no-results",
      recommendations,
      message: recommendations.length === 0 ? { code: "no-similar-books" } : undefined,
      seededFrom,
      seedTitle: item.title,
      page,
      pageSize,
      hasMore: all.length > page * pageSize,
      total: all.length,
    };
  }

  /** Seeded by the union of a profile's favourites. */
  async forProfile(profileId: number, options: { page?: number; pageSize?: number } = {}): Promise<DiscoverResult> {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;

    const favourites = await this.prisma.favourite.findMany({
      where: { profileId },
      include: {
        mediaItem: {
          include: {
            genres: { include: { genre: true } },
            contributors: { include: { contributor: true } },
            customTags: { include: { tag: true } },
            series: true,
          },
        },
      },
    });

    if (favourites.length === 0) {
      return {
        status: "insufficient-metadata",
        recommendations: [],
        message: { code: "favourites-need-details" },
        page,
        pageSize,
        hasMore: false,
        total: 0,
      };
    }

    const taggables: Taggable[] = favourites.map((row) => ({
      title: row.mediaItem.title,
      author: row.mediaItem.author,
      narrators: row.mediaItem.contributors
        .filter((link) => link.contributor.role === "narrator")
        .map((link) => link.contributor.name),
      seriesName: row.mediaItem.series?.name,
      seriesPosition: row.mediaItem.seriesPosition,
      genres: row.mediaItem.genres.map((r) => r.genre.slug),
      customTags: row.mediaItem.customTags.map((r) => r.tag.name),
      publishedYear: row.mediaItem.publishedYear,
      hasCover: Boolean(row.mediaItem.coverImagePath),
    }));

    const seed = buildSeed(taggables);
    const seededFrom = this.summarise(seed);

    if (!hasEnoughSignal(seed)) {
      return {
        status: "insufficient-metadata",
        recommendations: [],
        message: { code: "favourites-not-enough-metadata" },
        seededFrom,
        page,
        pageSize,
        hasMore: false,
        total: 0,
      };
    }

    const owned = await this.ownedIdentities();
    const all = this.shape(await this.expand(seed), seed, owned, RANK_LIMIT);
    const recommendations = all.slice((page - 1) * pageSize, page * pageSize);

    return {
      status: recommendations.length > 0 ? "ok" : "no-results",
      recommendations,
      message: recommendations.length === 0 ? { code: "no-new-books" } : undefined,
      seededFrom,
      page,
      pageSize,
      hasMore: all.length > page * pageSize,
      total: all.length,
    };
  }

  /** Save a recommendation to a profile's wishlist (idempotent). */
  async saveToWishlist(profileId: number, input: Recommendation, seedMediaItemId?: number) {
    if (!input.providerKey) {
      throw new Error("Cannot dedupe a recommendation without a provider key");
    }
    const existing = await this.prisma.wishlistItem.findUnique({
      where: {
        profileId_provider_providerKey: {
          profileId,
          provider: input.provider,
          providerKey: input.providerKey,
        },
      },
    });
    if (existing) return existing;

    return this.prisma.wishlistItem.create({
      data: {
        profileId,
        title: input.title,
        author: input.author ?? null,
        narrators: JSON.stringify(input.narrators ?? []),
        description: input.description ?? null,
        coverUrl: input.coverUrl ?? null,
        genres: JSON.stringify(input.genres ?? []),
        seriesName: input.seriesName ?? null,
        publisher: input.publisher ?? null,
        publishedYear: input.publishedYear ?? null,
        provider: input.provider,
        providerKey: input.providerKey,
        seedMediaItemId: seedMediaItemId ?? null,
      },
    });
  }
}