import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { RecommendationService } from "./recommend-service";
import { clearSubjectPoolCache } from "./openlibrary";
import { buildSeed } from "./recommend";
import type { ProviderCandidate } from "./types";

/**
 * Spec 43 addendum (2026-11-17) — "Christmas Carol now matches misc".
 *
 * Root cause: `expand()` browses the *top seed genres by weight*, and the
 * seed kept the catch-all slug. For a one-book seed every genre has weight
 * 1.0, so DB insertion order decides — and "misc" sorts high. `subject:misc`
 * returns an arbitrary pool, so Discover served whatever was under
 * "miscellaneous", which is indistinguishable from random.
 */

const subjectSearch = vi.hoisted(() => vi.fn());
vi.mock("./openlibrary", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./openlibrary")>()),
  searchOpenLibraryBySubject: subjectSearch,
}));

function candidate(title: string): ProviderCandidate {
  return {
    source: "openlibrary",
    title,
    author: "Some Author",
    genres: ["fiction"],
    confidence: 0.5,
    providerKey: `/works/${title}`,
  };
}

function fakePrisma(item: unknown) {
  return {
    mediaItem: {
      findUnique: vi.fn(async () => item ?? null),
      findMany: vi.fn(async () => []),
    },
    favourite: { findMany: vi.fn(async () => []) },
  } as unknown as PrismaClient;
}

const CAROL = {
  title: "A Christmas Carol",
  author: "Charles Dickens",
  publishedYear: 1843,
  coverImagePath: "/cover.jpg",
  contributors: [],
  customTags: [],
  // The real apply order from Open Library for this work: childrens first,
  // misc second; fiction third.
  genres: [
    { genre: { slug: "childrens" } },
    { genre: { slug: "misc" } },
    { genre: { slug: "horror" } },
    { genre: { slug: "fiction" } },
    { genre: { slug: "young-adult" } },
    { genre: { slug: "literary-fiction" } },
  ],
  series: null,
  seriesPosition: null,
};

beforeEach(() => {
  clearSubjectPoolCache();
  subjectSearch.mockReset();
  subjectSearch.mockResolvedValue([candidate("The Cratchit Family")]);
});

describe("seed construction skips the catch-all genre", () => {
  it("drops misc from the seed entirely", () => {
    const seed = buildSeed([{ title: "X", genres: ["misc", "fiction"], author: "A" }]);
    expect(seed.genres.has("misc")).toBe(false);
    expect(seed.genres.has("fiction")).toBe(true);
  });

  it("a misc-only seed has no genre signal, not a misc signal", () => {
    const seed = buildSeed([{ title: "X", genres: ["misc"] }]);
    expect(seed.genres.size).toBe(0);
  });
});

describe("similarTo never browses the catch-all subject", () => {
  it("queries fiction, not misc, for a Christmas Carol", async () => {
    const service = new RecommendationService(fakePrisma(CAROL));
    await service.similarTo(1, { page: 1, pageSize: 5 });

    const subjects = subjectSearch.mock.calls.map(([subject]) => subject as string);
    expect(subjects.length).toBeGreaterThan(0);
    expect(subjects).not.toContain("misc");
    expect(subjects).toContain("fiction");
  });
});
