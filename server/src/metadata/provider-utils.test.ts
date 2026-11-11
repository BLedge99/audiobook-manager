import { describe, it, expect } from "vitest";
import {
  normalizeSubjects,
  isNonBookTitle,
  pickLanguage,
  parseSeriesPosition,
} from "./provider-utils";

/**
 * Spec 25 — catalogue field extraction.
 *
 * The fixtures here are real API shapes captured on 2026-10-13, including the
 * awkward ones: Open Library merges every edition of a work, so `language`
 * arrives as the set of languages the book was ever published in.
 */

describe("normalizeSubjects", () => {
  it("keeps the specific head of a compound subject", () => {
    // Real Open Library subject strings.
    expect(normalizeSubjects(["Wizards -- Juvenile fiction"])).toEqual(["Wizards"]);
    expect(normalizeSubjects(["Harry Potter (Fictitious character) -- Fiction"])).toEqual(["Harry Potter"]);
  });

  it("keeps plain subjects untouched", () => {
    expect(normalizeSubjects(["Magic fiction", "Juvenile fiction"])).toEqual([
      "Magic fiction",
      "Juvenile fiction",
    ]);
  });

  it("drops empties, tiny values and non-strings", () => {
    expect(normalizeSubjects(["", "  ", "ab", 42, null, "Real genre"])).toEqual(["Real genre"]);
  });

  it("de-duplicates case-insensitively", () => {
    expect(normalizeSubjects(["Magic fiction", "magic fiction"])).toEqual(["Magic fiction"]);
  });

  it("tolerates a non-array", () => {
    expect(normalizeSubjects(undefined)).toEqual([]);
    expect(normalizeSubjects("Magic fiction")).toEqual([]);
  });
});

describe("pickLanguage", () => {
  it("takes the dominant language, not the first", () => {
    // Real payload for Harry Potter: four editions, English is not first.
    expect(pickLanguage(["gre", "urd", "arm", "vie"])).toBeUndefined();
    expect(pickLanguage(["gre", "urd", "eng", "eng", "vie"])).toBe("eng");
  });

  it("accepts a bare string", () => {
    expect(pickLanguage("eng")).toBe("eng");
  });

  it("rejects values that are not language codes", () => {
    expect(pickLanguage(["English", "klingon"])).toBeUndefined();
  });

  it("returns undefined for nothing usable", () => {
    expect(pickLanguage(undefined)).toBeUndefined();
    expect(pickLanguage([])).toBeUndefined();
  });
});

describe("parseSeriesPosition", () => {
  it("parses the numeric string Open Library returns", () => {
    expect(parseSeriesPosition(["4"])).toBe(4);
    expect(parseSeriesPosition(["2.5"])).toBe(2.5);
  });

  it("accepts a real number", () => {
    expect(parseSeriesPosition(1)).toBe(1);
  });

  it("rejects zero, negatives and junk", () => {
    // Position 0 is not "book zero" -- it is an interstitial or bad data.
    expect(parseSeriesPosition(["0"])).toBeUndefined();
    expect(parseSeriesPosition([-1])).toBeUndefined();
    expect(parseSeriesPosition(["unknown"])).toBeUndefined();
    expect(parseSeriesPosition(undefined)).toBeUndefined();
  });
});

describe("isNonBookTitle", () => {
  it("refuses study-guide and companion spam", () => {
    // Real Open Library results captured 2026-10-13 for Deathly Hallows.
    expect(isNonBookTitle("Summary of Harry Potter and the Deathly Hallows")).toBe(true);
    expect(isNonBookTitle("Conversations on Harry Potter and the Deathly Hallows")).toBe(true);
    expect(isNonBookTitle("Study Guide")).toBe(true);
    expect(isNonBookTitle("Analysis of Dune")).toBe(true);
    expect(isNonBookTitle("A Study of Victorian Fiction")).toBe(true);
  });

  it("keeps real books", () => {
    expect(isNonBookTitle("Harry Potter and the Deathly Hallows")).toBe(false);
    expect(isNonBookTitle("The Awakening")).toBe(false);
    expect(isNonBookTitle("Summary to Die For")).toBe(false);
    expect(isNonBookTitle("The Study in Scarlet")).toBe(false);
  });

  it("treats a missing title as non-book", () => {
    expect(isNonBookTitle("")).toBe(true);
    expect(isNonBookTitle(null)).toBe(true);
  });
});
