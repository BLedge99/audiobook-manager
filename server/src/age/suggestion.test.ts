import { describe, expect, it } from "vitest";
import {
  inferMinimumAgeFromSubjects,
  minimumAgeFromGoogleBooksMaturity,
  suggestionForCandidate,
} from "./suggestion";

describe("inferMinimumAgeFromSubjects (spec 38)", () => {
  it("maps the documented Open Library subject ladder", () => {
    expect(inferMinimumAgeFromSubjects(["Picture books"])).toBe(6);
    expect(inferMinimumAgeFromSubjects(["Children's picture books"])).toBe(6);
    expect(inferMinimumAgeFromSubjects(["Children's literature"])).toBe(9);
    expect(inferMinimumAgeFromSubjects(["Juvenile fiction"])).toBe(12);
    expect(inferMinimumAgeFromSubjects(["Juvenile literature"])).toBe(12);
    expect(inferMinimumAgeFromSubjects(["Middle grade fiction"])).toBe(12);
    expect(inferMinimumAgeFromSubjects(["Young adult fiction"])).toBe(13);
    expect(inferMinimumAgeFromSubjects(["Teen literature"])).toBe(13);
  });

  it("splits Open Library's qualified subjects on '--' before matching", () => {
    // "Wizards -- Juvenile fiction": the head is not a ladder subject, the tail is.
    expect(inferMinimumAgeFromSubjects(["Wizards -- Juvenile fiction"])).toBe(12);
    expect(inferMinimumAgeFromSubjects(["Magic -- Children's literature"])).toBe(9);
    expect(inferMinimumAgeFromSubjects(["Dragons -- Young adult fiction"])).toBe(13);
    // An unqualified head alone is not enough.
    expect(inferMinimumAgeFromSubjects(["Wizards"])).toBeNull();
  });

  it("normalises case, hyphens and underscores (provider slugs)", () => {
    expect(inferMinimumAgeFromSubjects(["picture-books"])).toBe(6);
    expect(inferMinimumAgeFromSubjects(["young_adult_fiction"])).toBe(13);
    expect(inferMinimumAgeFromSubjects(["juvenile___fiction"])).toBe(12);
  });

  it("returns null when nothing matches (unknown ⇒ excluded downstream)", () => {
    expect(inferMinimumAgeFromSubjects(["Fiction"])).toBeNull();
    expect(inferMinimumAgeFromSubjects(["Adult fiction", "Horror"])).toBeNull();
    expect(inferMinimumAgeFromSubjects([])).toBeNull();
    expect(inferMinimumAgeFromSubjects(null)).toBeNull();
    expect(inferMinimumAgeFromSubjects(undefined)).toBeNull();
  });

  it("first rule in the ladder wins when several match", () => {
    // picture books (6) is more specific than juvenile fiction (12).
    expect(inferMinimumAgeFromSubjects(["Juvenile fiction", "Picture books"])).toBe(6);
  });
});

describe("suggestionForCandidate (spec 38)", () => {
  it("Google Books MATURE wins over any subject ladder even when juvenile", () => {
    expect(suggestionForCandidate({ source: "googlebooks", maturityRating: "MATURE", genres: ["Juvenile Fiction"] })).toBe(16);
    expect(suggestionForCandidate({ source: "googlebooks", maturityRating: "NOT_MATURE", genres: ["Juvenile Fiction"] })).toBe(12);
    expect(suggestionForCandidate({ source: "googlebooks", genres: ["Juvenile Fiction"] })).toBe(12);
  });

  it("Open Library reads verbatim subjects before the mapped genres", () => {
    expect(suggestionForCandidate({ source: "openlibrary", subjectStrings: ["Wizards -- Juvenile fiction"], genres: ["Wizards"] })).toBe(12);
    expect(suggestionForCandidate({ source: "openlibrary", genres: ["Wizards"] })).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(suggestionForCandidate({ source: "librivox", genres: ["Horror"] })).toBeNull();
    expect(suggestionForCandidate({})).toBeNull();
  });
});

describe("minimumAgeFromGoogleBooksMaturity (spec 38)", () => {
  it("maps MATURE to 16", () => {
    expect(minimumAgeFromGoogleBooksMaturity("MATURE")).toBe(16);
  });

  it("maps NOT_MATURE / UNKNOWN / absent to no suggestion", () => {
    expect(minimumAgeFromGoogleBooksMaturity("NOT_MATURE")).toBeNull();
    expect(minimumAgeFromGoogleBooksMaturity("UNKNOWN")).toBeNull();
    expect(minimumAgeFromGoogleBooksMaturity(null)).toBeNull();
    expect(minimumAgeFromGoogleBooksMaturity(undefined)).toBeNull();
    expect(minimumAgeFromGoogleBooksMaturity("mature")).toBeNull(); // case-sensitive as the API emits
  });
});
