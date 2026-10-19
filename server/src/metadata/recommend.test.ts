import { describe, it, expect } from "vitest";
import {
  RECOMMENDATION_WEIGHTS,
  buildOwnedIdentities,
  buildSeed,
  hasEnoughSignal,
  ownedIdentity,
  rankCandidates,
  scoreCandidate,
  searchTermsFor,
  type Taggable,
} from "./recommend";

/**
 * Spec 19 / ADR 010 — recommendation seeding, ranking and dedupe.
 *
 * Pure by design, so the behaviour that matters (dedupe against owned books,
 * weighting shared genres above single matches, refusing to rank on nothing)
 * is testable without a database or a network.
 */

const dune: Taggable = {
  title: "Dune",
  author: "Frank Herbert",
  genres: ["science-fiction", "space-opera"],
  narrators: ["Simon Vance"],
  seriesName: "Dune",
};

const duneMessiah: Taggable = {
  title: "Dune Messiah",
  author: "Frank Herbert",
  genres: ["science-fiction"],
  narrators: ["Simon Vance"],
  seriesName: "Dune",
};

const prideAndPrejudice: Taggable = {
  title: "Pride and Prejudice",
  author: "Jane Austen",
  genres: ["romantic-fiction"],
  seriesName: null,
};

describe("ownedIdentity", () => {
  it("normalises case, punctuation and whitespace", () => {
    expect(ownedIdentity("The  Hobbit!", "J.R.R. Tolkien")).toBe(ownedIdentity("the hobbit", "j r r tolkien"));
  });

  it("distinguishes books sharing a title but not an author", () => {
    expect(ownedIdentity("Dune", "Frank Herbert")).not.toBe(ownedIdentity("Dune", "Someone Else"));
  });

  it("handles a missing author", () => {
    expect(ownedIdentity("Untitled")).toBe(ownedIdentity("Untitled", null));
  });
});

describe("buildSeed", () => {
  it("extracts every dimension from one book", () => {
    const seed = buildSeed([dune]);
    expect(seed.genres.has("science fiction")).toBe(true);
    expect(seed.authors.has("frank herbert")).toBe(true);
    expect(seed.narrators.has("simon vance")).toBe(true);
    expect(seed.series.has("dune")).toBe(true);
    expect(seed.sources).toBe(1);
  });

  it("counts a tag shared by several books more heavily", () => {
    const seed = buildSeed([dune, duneMessiah, prideAndPrejudice]);
    // science-fiction is shared by two of three; romance by one.
    expect(seed.genres.get("science fiction")).toBeGreaterThan(seed.genres.get("romantic fiction")!);
  });

  it("ignores empty values", () => {
    const seed = buildSeed([{ title: "X", author: null, genres: [""], seriesName: null }]);
    expect(seed.authors.size).toBe(0);
    expect(seed.genres.size).toBe(0);
  });

  it("handles an empty seed set", () => {
    const seed = buildSeed([]);
    expect(seed.sources).toBe(0);
    expect(hasEnoughSignal(seed)).toBe(false);
  });
});

describe("scoreCandidate", () => {
  it("scores a shared genre highest", () => {
    const seed = buildSeed([dune]);
    expect(scoreCandidate(duneMessiah, seed)).toBeGreaterThan(scoreCandidate(prideAndPrejudice, seed));
  });

  it("scores a candidate with no shared signal at zero", () => {
    const seed = buildSeed([dune]);
    expect(scoreCandidate(prideAndPrejudice, seed)).toBe(0);
  });

  it("is case-insensitive", () => {
    const seed = buildSeed([dune]);
    expect(scoreCandidate({ ...dune, genres: ["Science-Fiction"] }, seed)).toBeGreaterThan(0);
  });

  it("rewards a genre shared across more of the seed set", () => {
    const broad = buildSeed([dune, duneMessiah]);
    const narrow = buildSeed([dune, prideAndPrejudice]);
    const candidate: Taggable = { title: "X", genres: ["science-fiction"] };
    expect(scoreCandidate(candidate, broad)).toBeGreaterThan(scoreCandidate(candidate, narrow));
  });

  it("treats a narrator match as a real but secondary signal", () => {
    const seed = buildSeed([dune]);
    const sameNarrator: Taggable = { title: "Other", genres: [], narrators: ["Simon Vance"] };
    expect(scoreCandidate(sameNarrator, seed)).toBeGreaterThan(0);
    expect(scoreCandidate(sameNarrator, seed)).toBeLessThanOrEqual(RECOMMENDATION_WEIGHTS.narrator);
  });
});

describe("rankCandidates", () => {
  it("orders by score, highest first", () => {
    const seed = buildSeed([dune]);
    // The seed book itself is always excluded as owned in real use, so the
    // owned set is supplied here rather than expecting it to be filtered out.
    const owned = buildOwnedIdentities([{ title: "Dune", author: "Frank Herbert" }]);
    const sameAuthor: Taggable = {
      title: "The Dragon's of Eden",
      author: "Frank Herbert",
      genres: ["science-fiction"],
    };
    const ranked = rankCandidates([prideAndPrejudice, sameAuthor, duneMessiah], seed, {
      ownedIdentities: owned,
    });

    expect(ranked[0].candidate.title).toBe("Dune Messiah");
    // Pride and Prejudice shares no signal at all and falls below the noise
    // floor, so exactly the two related titles survive.
    expect(ranked).toHaveLength(2);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it("scores the seed book highest against itself, before owned-exclusion", () => {
    // Confirms ranking is doing real work: similarity to self is maximal, and
    // the hard dedupe is what removes it.
    const seed = buildSeed([dune]);
    const ranked = rankCandidates([dune, duneMessiah, prideAndPrejudice], seed);
    expect(ranked[0].candidate.title).toBe("Dune");
  });

  it("hard-excludes a book the library already owns", () => {
    const seed = buildSeed([dune]);
    const owned = buildOwnedIdentities([{ title: "Dune", author: "Frank Herbert" }]);
    const ranked = rankCandidates([dune, duneMessiah], seed, { ownedIdentities: owned });
    expect(ranked.map((entry) => entry.candidate.title)).not.toContain("Dune");
    expect(ranked.map((entry) => entry.candidate.title)).toContain("Dune Messiah");
  });

  it("excludes owned books despite case and punctuation differences", () => {
    const seed = buildSeed([dune]);
    const owned = buildOwnedIdentities([{ title: "dune!", author: "frank herbert" }]);
    const ranked = rankCandidates([dune], seed, { ownedIdentities: owned });
    expect(ranked).toHaveLength(0);
  });

  it("collapses duplicate candidates to one result", () => {
    const seed = buildSeed([dune]);
    const ranked = rankCandidates([dune, dune, dune], seed);
    expect(ranked).toHaveLength(1);
  });

  it("drops candidates below the noise floor", () => {
    const seed = buildSeed([dune]);
    const ranked = rankCandidates([prideAndPrejudice], seed, { minScore: 0.2 });
    expect(ranked).toHaveLength(0);
  });

  it("respects the limit", () => {
    const seed = buildSeed([dune]);
    const many: Taggable[] = Array.from({ length: 30 }, (_, i) => ({
      title: `Book ${i}`,
      genres: ["science-fiction"],
    }));
    expect(rankCandidates(many, seed, { limit: 5 })).toHaveLength(5);
  });

  it("ignores candidates with a blank title", () => {
    const seed = buildSeed([dune]);
    expect(rankCandidates([{ title: "   ", genres: ["science-fiction"] }], seed)).toHaveLength(0);
  });

  it("returns nothing when every candidate is owned", () => {
    const seed = buildSeed([dune]);
    const owned = buildOwnedIdentities([{ title: "Dune", author: "Frank Herbert" }]);
    expect(rankCandidates([dune], seed, { ownedIdentities: owned })).toHaveLength(0);
  });
});

describe("hasEnoughSignal", () => {
  it("refuses a single-book seed with no other dimensions", () => {
    // One book and one genre is too thin to recommend from; better to say so.
    expect(hasEnoughSignal(buildSeed([{ title: "X", genres: ["fiction"] }]))).toBe(false);
  });

  it("accepts a seed with two distinct signals", () => {
    expect(hasEnoughSignal(buildSeed([dune]))).toBe(true);
  });

  it("rejects an empty seed", () => {
    expect(hasEnoughSignal(buildSeed([]))).toBe(false);
  });
});

describe("searchTermsFor", () => {
  it("leads with the strongest shared signal", () => {
    const seed = buildSeed([dune, duneMessiah, prideAndPrejudice]);
    const terms = searchTermsFor(seed);
    expect(terms[0]).toBe("science fiction");
  });

  it("caps the number of terms so providers are not hammered", () => {
    const seed = buildSeed([dune, duneMessiah, prideAndPrejudice]);
    expect(searchTermsFor(seed, 2)).toHaveLength(2);
  });

  it("returns nothing for an empty seed", () => {
    expect(searchTermsFor(buildSeed([]))).toEqual([]);
  });
});

describe("buildOwnedIdentities", () => {
  it("produces a set covering every owned book", () => {
    const owned = buildOwnedIdentities([
      { title: "Dune", author: "Frank Herbert" },
      { title: "Emma", author: "Jane Austen" },
    ]);
    expect(owned.size).toBe(2);
    expect(owned.has(ownedIdentity("Dune", "Frank Herbert"))).toBe(true);
  });
});
/**
 * Spec 15b feature 3 -- the three ranking signals added after the tester said
 * Discover "needs work to find more similar matches".
 *
 * Each is a *refinement* of an order tag similarity already established, which
 * is why the weights are small. A test that only checked "the new signal moves
 * things up" would pass even if it moved them above an actual tag match, so
 * there is a test for that too.
 */
describe("refinement signals (spec 15b feature 3)", () => {
  const modernHorror: Taggable = {
    title: "Modern Horror",
    genres: ["horror"],
    publishedYear: 2015,
    hasCover: true,
  };

  it("prefers a candidate from the seed's era over one from a different one", () => {
    const seed = buildSeed([{ title: "Seed", genres: ["horror"], publishedYear: 2015 }]);
    const near = { title: "Near", genres: ["horror"], publishedYear: 2018 };
    const far = { title: "Far", genres: ["horror"], publishedYear: 1961 };
    // Same genre overlap, so only era separates them.
    expect(scoreCandidate(near, seed)).toBeGreaterThan(scoreCandidate(far, seed));
  });

  it("uses the median decade, not the mean", () => {
    // One 1895 collection and five modern books. A mean lands in the 1970s and
    // describes nobody; the median describes what this household actually reads.
    const seed = buildSeed([
      { title: "Antique", genres: ["horror"], publishedYear: 1895 },
      ...Array.from({ length: 5 }, (_, i) => ({ title: `Modern ${i}`, genres: ["horror"], publishedYear: 2015 })),
    ]);
    const modern = { title: "Modern Pick", genres: ["horror"], publishedYear: 2015 };
    const antique = { title: "Antique Pick", genres: ["horror"], publishedYear: 1890 };
    expect(scoreCandidate(modern, seed)).toBeGreaterThan(scoreCandidate(antique, seed));
  });

  it("gives no era signal when the seed has no years at all", () => {
    // Rather than inventing a decade from nothing.
    const seed = buildSeed([{ title: "Undated", genres: ["horror"] }]);
    expect(scoreCandidate({ title: "Anything", genres: ["horror"], publishedYear: 2015 }, seed)).toBe(
      scoreCandidate({ title: "Anything Else", genres: ["horror"] }, seed),
    );
  });

  it("ignores absurd years rather than scoring them", () => {
    const seed = buildSeed([modernHorror]);
    const nonsense = { title: "Nonsense", genres: ["horror"], publishedYear: 0 };
    const noYear = { title: "No Year", genres: ["horror"] };
    expect(scoreCandidate(nonsense, seed)).toBe(scoreCandidate(noYear, seed));
  });

  it("prefers the next book in a series the seed already reads", () => {
    const seed = buildSeed([
      { title: "Expanse 1", genres: ["science-fiction"], seriesName: "The Expanse", seriesPosition: 1 },
    ]);
    const next = { title: "Expanse 2", genres: ["science-fiction"], seriesName: "The Expanse", seriesPosition: 2 };
    const unrelated = { title: "Expanse 9", genres: ["science-fiction"], seriesName: "The Expanse", seriesPosition: 9 };
    expect(scoreCandidate(next, seed)).toBeGreaterThan(scoreCandidate(unrelated, seed));
  });

  it("tolerates an off-by-one series position, because providers get it wrong", () => {
    const seed = buildSeed([
      { title: "Book 1", genres: ["fiction"], seriesName: "Trilogy", seriesPosition: 1 },
    ]);
    // Providers frequently omit or mis-shift `series_position`.
    const shifted = { title: "Book 3", genres: ["fiction"], seriesName: "Trilogy", seriesPosition: 3 };
    expect(scoreCandidate(shifted, seed)).toBeGreaterThan(0);
  });

  it("prefers a candidate that has cover art", () => {
    // Not cosmetic: `subject:` search returns a pool with many coverless records,
    // and the UI can only render those as a placeholder.
    const seed = buildSeed([{ title: "Seed", genres: ["horror"] }]);
    const withCover = { title: "A", genres: ["horror"], hasCover: true };
    const without = { title: "B", genres: ["horror"], hasCover: false };
    expect(scoreCandidate(withCover, seed)).toBeGreaterThan(scoreCandidate(without, seed));
  });

  it("keeps every refinement below an actual tag match", () => {
    // The failure mode this feature could have caused: era and cover presence
    // outranking similarity, turning a subject browse into a popularity listing.
    const seed = buildSeed([{ title: "Seed", genres: ["horror"], publishedYear: 2015 }]);
    const sameEraWithCover = { title: "Popular", genres: ["romance"], publishedYear: 2015, hasCover: true };
    const differentEraButSameGenre = { title: "Related", genres: ["horror"], publishedYear: 1970 };
    expect(scoreCandidate(differentEraButSameGenre, seed)).toBeGreaterThan(
      scoreCandidate(sameEraWithCover, seed),
    );
  });
});
