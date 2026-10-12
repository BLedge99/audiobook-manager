import type { PrismaClient } from "@prisma/client";
import { AudnexusProvider } from "./audnexus";
import { LibrivoxProvider } from "./librivox";
import {
  buildOwnedIdentities,
  buildSeed,
  hasEnoughSignal,
  rankCandidates,
  searchTermsFor,
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
  reason: string;
}

export type DiscoverStatus = "ok" | "offline" | "insufficient-metadata" | "no-results";

export interface DiscoverResult {
  status: DiscoverStatus;
  recommendations: Recommendation[];
  /** Present when status is not ok, so the UI can explain itself. */
  message?: string;
  /** The tags the recommendations were drawn from, for transparency. */
  seededFrom?: {
    genres: string[];
    authors: string[];
    series: string[];
    bookCount: number;
  };
}

function toTaggable(candidate: ProviderCandidate): Taggable {
  return {
    title: candidate.title,
    author: candidate.author,
    narrators: candidate.narrators ?? [],
    seriesName: candidate.seriesName,
    genres: candidate.genres ?? [],
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
function explain(candidate: Taggable, seed: ReturnType<typeof buildSeed>): string {
  const shared = (values: string[], map: Map<string, number>): string[] =>
    (values ?? []).filter((value) => map.has(value.trim().toLowerCase()));

  const genreHits = shared(candidate.genres ?? [], seed.genres);
  if (genreHits.length > 0) return `Because it shares the genre ${genreHits[0]}`;
  if (candidate.author && seed.authors.has(candidate.author.trim().toLowerCase())) {
    return `Because you like ${candidate.author}`;
  }
  if (candidate.seriesName && seed.series.has(candidate.seriesName.trim().toLowerCase())) {
    return `Because it is in the ${candidate.seriesName} series`;
  }
  return "Related to books you enjoy";
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
   */
  private async expand(seed: ReturnType<typeof buildSeed>): Promise<ProviderCandidate[]> {
    const terms = searchTermsFor(seed);
    if (terms.length === 0) return [];

    const librivox = new LibrivoxProvider();
    const audnexus = new AudnexusProvider();

    const results = await Promise.allSettled(
      terms.flatMap((term) => [
        audnexus.search({ title: term }),
        // LibriVox does exact title matching, so an author or genre term is
        // usually a miss for it; still worth one cheap attempt per term.
        librivox.search({ title: term }),
      ]),
    );

    const pool: ProviderCandidate[] = [];
    for (const result of results) {
      if (result.status === "fulfilled") pool.push(...result.value);
    }
    return pool;
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
  async similarTo(mediaItemId: number, limit = 20): Promise<DiscoverResult & { seedTitle?: string }> {
    const item = await this.prisma.mediaItem.findUnique({
      where: { id: mediaItemId },
      include: {
        genres: { include: { genre: true } },
        contributors: { include: { contributor: true } },
        customTags: { include: { tag: true } },
        series: true,
      },
    });
    if (!item) return { status: "no-results", recommendations: [] };

    const taggable: Taggable = {
      title: item.title,
      author: item.author,
      narrators: item.contributors
        .filter((link) => link.contributor.role === "narrator")
        .map((link) => link.contributor.name),
      seriesName: item.series?.name,
      genres: item.genres.map((row) => row.genre.slug),
      customTags: item.customTags.map((row) => row.tag.name),
    };

    const seed = buildSeed([taggable]);
    const seededFrom = this.summarise(seed);

    if (!hasEnoughSignal(seed)) {
      return {
        status: "insufficient-metadata",
        recommendations: [],
        message: "This book needs a bit more metadata before we can suggest similar titles.",
        seededFrom,
        seedTitle: item.title,
      };
    }

    const pool = await this.expand(seed);
    const owned = await this.ownedIdentities();
    const recommendations = this.shape(pool, seed, owned, limit);

    return {
      status: recommendations.length > 0 ? "ok" : "no-results",
      recommendations,
      message: recommendations.length === 0 ? "No similar titles found." : undefined,
      seededFrom,
      seedTitle: item.title,
    };
  }

  /** Seeded by the union of a profile's favourites. */
  async forProfile(profileId: number, limit = 20): Promise<DiscoverResult> {
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
        message: "Favourite a few books and Discover will use them to find more like these.",
      };
    }

    const taggables: Taggable[] = favourites.map((row) => ({
      title: row.mediaItem.title,
      author: row.mediaItem.author,
      narrators: row.mediaItem.contributors
        .filter((link) => link.contributor.role === "narrator")
        .map((link) => link.contributor.name),
      seriesName: row.mediaItem.series?.name,
      genres: row.mediaItem.genres.map((r) => r.genre.slug),
      customTags: row.mediaItem.customTags.map((r) => r.tag.name),
    }));

    const seed = buildSeed(taggables);
    const seededFrom = this.summarise(seed);

    if (!hasEnoughSignal(seed)) {
      return {
        status: "insufficient-metadata",
        recommendations: [],
        message: "Your favourites need a bit more metadata before we can suggest anything.",
        seededFrom,
      };
    }

    const pool = await this.expand(seed);
    const owned = await this.ownedIdentities();
    const recommendations = this.shape(pool, seed, owned, limit);

    return {
      status: recommendations.length > 0 ? "ok" : "no-results",
      recommendations,
      message: recommendations.length === 0 ? "No new titles found yet." : undefined,
      seededFrom,
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