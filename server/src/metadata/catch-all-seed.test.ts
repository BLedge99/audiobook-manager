import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { RecommendationService } from "./recommend-service";
import { clearSubjectPoolCache } from "./openlibrary";
import { buildSeed } from "./recommend";
import type { ProviderCandidate } from "./types";

const subjectSearch = vi.hoisted(() => vi.fn());
vi.mock("./openlibrary", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./openlibrary")>()),
  searchOpenLibraryBySubject: subjectSearch,
}));

function candidate(title: string, genres = ["fiction"]): ProviderCandidate {
  return {
    source: "openlibrary",
    title,
    author: "Some Author",
    genres,
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

describe("seed construction uses catch-all only as a fallback", () => {
  it("omits misc when topical genres are available", () => {
    const seed = buildSeed([{ title: "X", genres: ["misc", "fiction"], author: "A" }]);
    expect(seed.genres.has("misc")).toBe(false);
    expect(seed.genres.has("fiction")).toBe(true);
  });

  it("retains misc when no topical genre is available", () => {
    const seed = buildSeed([{ title: "X", genres: ["misc"], author: "A" }]);
    expect(seed.genres.get("misc")).toBeGreaterThan(0);
  });
});

describe("similarTo prefers topical genres over the catch-all subject", () => {
  it("queries fiction, not misc, when a topical genre is available", async () => {
    const service = new RecommendationService(fakePrisma(CAROL));
    await service.similarTo(1, { page: 1, pageSize: 5 });

    const subjects = subjectSearch.mock.calls.map(([subject]) => subject as string);
    expect(subjects.length).toBeGreaterThan(0);
    expect(subjects).not.toContain("misc");
    expect(subjects).toContain("fiction");
  });

  it("queries misc and returns ranked results when no topical genre is available", async () => {
    const item = {
      title: "An Unenriched Book",
      author: "A Known Author",
      contributors: [],
      customTags: [],
      genres: [{ genre: { slug: "misc" } }],
      series: null,
      seriesPosition: null,
    };
    subjectSearch.mockResolvedValue([candidate("Another Book", ["misc"])]);

    const service = new RecommendationService(fakePrisma(item));
    const result = await service.similarTo(1, { page: 1, pageSize: 5 });

    const subjects = subjectSearch.mock.calls.map(([subject]) => subject as string);
    expect(subjects).toContain("misc");
    expect(result.recommendations.map(({ title }) => title)).toContain("Another Book");
  });
});
