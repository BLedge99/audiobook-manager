import { describe, expect, it } from "vitest";
import {
  inferMinimumAgeFromSubjects,
  minimumAgeFromGoogleBooksMaturity,
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
