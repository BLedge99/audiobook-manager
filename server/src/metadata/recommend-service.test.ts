import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { RecommendationService } from "./recommend-service";
import { clearSubjectPoolCache } from "../enrichment";
import type { ProviderCandidate } from "./types";

/**
 * Spec 15b feature 3 — Discover's paging and ranking.
 *
 * The tester's words: results came back "at random", and they asked for "top 5 at
 * a time, then allow a 'load more' button".
 *
 * The property worth protecting is that **page 2 continues page 1**. That is not
 * the same as "page 2 is another five results": if each page were ranked
 * independently the two pages could disagree entirely, which is precisely the
 * randomness being fixed. So the assertions here are about *order across pages*,
 * not about counts.
 */

const subjectSearch = vi.hoisted(() => vi.fn());
vi.mock("../enrichment", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../enrichment")>()),
  searchOpenLibraryBySubject: subjectSearch,
}));

/**
 * A candidate shaped like what the Open Library mapper produces.
 *
 * `hasCover` is deliberately *not* set: the service derives it from `coverUrl`
 * (`toTaggable` sets `hasCover: Boolean(candidate.coverUrl)`), so a candidate
 * with a cover URL already scores as having one.
 */
function candidate(title: string, extra: Partial<ProviderCandidate> = {}): ProviderCandidate {
  return {
    source: "openlibrary",
    title,
    author: "Some Author",
    genres: ["horror"],
    confidence: 0.5,
    providerKey: `/works/${title}`,
    ...extra,
  };
}

/** A pool with a known spread of scores, so page boundaries are predictable. */
function poolOf(count: number): ProviderCandidate[] {
  return Array.from({ length: count }, (_, i) =>
    candidate(`Book ${String(i).padStart(3, "0")}`, {
      // Varying year shifts the era signal, giving a deterministic order.
      publishedYear: 2000 + (count - i),
      coverUrl: `http://covers/${i}.jpg`,
    }),
  );
}

function fakePrisma(options: { favourites?: unknown[]; item?: unknown } = {}) {
  return {
    mediaItem: {
      findUnique: vi.fn(async () => options.item ?? null),
      findMany: vi.fn(async () => []), // owned identities: empty
    },
    favourite: { findMany: vi.fn(async () => options.favourites ?? []) },
  } as unknown as PrismaClient;
}

const FAVOURITE = {
  mediaItem: {
    title: "Seed Book",
    author: "Seed Author",
    publishedYear: 2015,
    coverImagePath: "/cover.jpg",
    contributors: [],
    customTags: [],
    genres: [{ genre: { slug: "horror" } }],
    series: null,
    seriesPosition: null,
  },
};

beforeEach(() => {
  clearSubjectPoolCache();
  subjectSearch.mockReset();
});

describe("discover paging", () => {
  it("returns five at a time and says there is more", async () => {
    subjectSearch.mockResolvedValue(poolOf(40));
    const service = new RecommendationService(fakePrisma({ favourites: [FAVOURITE] }));

    const page1 = await service.forProfile(1, { page: 1, pageSize: 5 });

    expect(page1.recommendations).toHaveLength(5);
    expect(page1.page).toBe(1);
    expect(page1.pageSize).toBe(5);
    expect(page1.hasMore).toBe(true);
    expect(page1.total).toBeGreaterThan(5);
  });

  it("page 2 continues page 1 rather than re-rolling the dice", async () => {
    subjectSearch.mockResolvedValue(poolOf(40));
    const service = new RecommendationService(fakePrisma({ favourites: [FAVOURITE] }));

    const page1 = await service.forProfile(1, { page: 1, pageSize: 5 });
    const page2 = await service.forProfile(1, { page: 2, pageSize: 5 });
    const page3 = await service.forProfile(1, { page: 3, pageSize: 5 });

    const titles = [...page1.recommendations, ...page2.recommendations, ...page3.recommendations].map((r) => r.title);
    // No repeats across pages...
    expect(new Set(titles).size).toBe(titles.length);
    // ...and scores never climb as you page deeper, because it is one ranking.
    const scores = [...page1.recommendations, ...page2.recommendations, ...page3.recommendations].map((r) => r.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("paginates the 'find more like this' route the same way", async () => {
    subjectSearch.mockResolvedValue(poolOf(30));
    const item = {
      title: "Seed Book",
      author: "Seed Author",
      publishedYear: 2015,
      coverImagePath: "/cover.jpg",
      contributors: [],
      customTags: [],
      genres: [{ genre: { slug: "horror" } }],
      series: null,
      seriesPosition: null,
    };
    const service = new RecommendationService(fakePrisma({ item }));

    const page1 = await service.similarTo(1, { page: 1, pageSize: 5 });
    const page2 = await service.similarTo(1, { page: 2, pageSize: 5 });

    expect(page1.recommendations).toHaveLength(5);
    expect(page1.hasMore).toBe(true);
    expect(page2.page).toBe(2);
    const overlap = page1.recommendations.filter((r) => page2.recommendations.some((s) => s.title === r.title));
    expect(overlap).toHaveLength(0);
  });

  it("reports hasMore false on the last page", async () => {
    subjectSearch.mockResolvedValue(poolOf(7));
    const service = new RecommendationService(fakePrisma({ favourites: [FAVOURITE] }));

    const page1 = await service.forProfile(1, { page: 1, pageSize: 5 });
    const page2 = await service.forProfile(1, { page: 2, pageSize: 5 });

    expect(page1.hasMore).toBe(true);
    expect(page2.recommendations).toHaveLength(2);
    expect(page2.hasMore).toBe(false);
  });

  it("defaults to five when no page size is asked for", async () => {
    subjectSearch.mockResolvedValue(poolOf(40));
    const service = new RecommendationService(fakePrisma({ favourites: [FAVOURITE] }));
    const result = await service.forProfile(1);
    expect(result.pageSize).toBe(5);
    expect(result.recommendations).toHaveLength(5);
  });

  it("still explains itself, with page metadata, when there is not enough metadata", async () => {
    // Every shape the UI reads must exist, or a status message renders as
    // `undefined` next to a "Show more" button that has nothing to show.
    subjectSearch.mockResolvedValue([]);
    const service = new RecommendationService(fakePrisma({ favourites: [] }));
    const result = await service.forProfile(1);

    expect(result.status).toBe("insufficient-metadata");
    expect(result.recommendations).toEqual([]);
    expect(result.hasMore).toBe(false);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(5);
  });

  it("pulls several pages from the provider and dedupes them", async () => {
    // The pool is what makes paging meaningful: one page would leave page 2
    // with nothing to say.
    const perCall = poolOf(20);
    subjectSearch.mockImplementation(async (_subject: string, options: { page?: number }) =>
      // Both pages return the same books, as real subject searches do when a
      // book carries several of the requested subjects.
      options?.page === 1 ? perCall : perCall,
    );
    const service = new RecommendationService(fakePrisma({ favourites: [FAVOURITE] }));
    const result = await service.forProfile(1, { page: 1, pageSize: 5 });

    // Two pages per subject, in parallel, for the seed's subjects.
    expect(subjectSearch.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(new Set(result.recommendations.map((r) => r.title)).size).toBe(result.recommendations.length);
  });

  it("treats a page beyond the end as empty rather than failing", async () => {
    subjectSearch.mockResolvedValue(poolOf(6));
    const service = new RecommendationService(fakePrisma({ favourites: [FAVOURITE] }));
    const result = await service.forProfile(1, { page: 99, pageSize: 5 });

    expect(result.recommendations).toEqual([]);
    expect(result.hasMore).toBe(false);
    expect(result.status).toBe("no-results");
  });
});
