import { describe, it, expect } from "vitest";
import { GENRE_TAXONOMY, PROVIDER_GENRE_MAPPING } from "./taxonomy";
import { normalizeSubjects, isJunkSubject } from "../enrichment";

/**
 * Spec 25 — genre mapping integrity.
 *
 * The mapping is a plain object literal, so a typo is invisible to the
 * compiler and silently falls through to the catch-all at runtime: a book
 * lands in "Miscellaneous" and nothing anywhere reports why. These tests exist
 * so that failure mode is a failing test instead.
 */

function allSlugs(): Set<string> {
  const slugs = new Set<string>();
  for (const parent of GENRE_TAXONOMY) {
    slugs.add(parent.slug);
    for (const child of parent.children ?? []) slugs.add(child.slug);
  }
  return slugs;
}

describe("PROVIDER_GENRE_MAPPING targets", () => {
  const slugs = allSlugs();

  it("only maps to slugs that exist in the taxonomy", () => {
    const unknown: string[] = [];
    for (const [provider, mapping] of Object.entries(PROVIDER_GENRE_MAPPING)) {
      for (const [raw, slug] of Object.entries(mapping)) {
        if (!slugs.has(slug)) unknown.push(`${provider}."${raw}" -> ${slug}`);
      }
    }
    expect(unknown, "mapping targets that do not exist: " + unknown.join(", ")).toEqual([]);
  });

  it("never maps to the catch-all explicitly", () => {
    // Unmapped values fall back to the catch-all automatically; naming it
    // would suggest an intentional mapping that does not exist.
    for (const [provider, mapping] of Object.entries(PROVIDER_GENRE_MAPPING)) {
      for (const [raw, slug] of Object.entries(mapping)) {
        expect(slug, `${provider}."${raw}"`).not.toBe("misc");
      }
    }
  });

  it("covers every provider we actually query", () => {
    for (const provider of ["openlibrary", "googlebooks", "librivox", "audnexus"]) {
      expect(PROVIDER_GENRE_MAPPING[provider], provider).toBeDefined();
    }
  });

  it("has no duplicate keys within a provider", () => {
    for (const [provider, mapping] of Object.entries(PROVIDER_GENRE_MAPPING)) {
      const lowered = Object.keys(mapping).map((k) => k.toLowerCase());
      expect(new Set(lowered).size, provider).toBe(lowered.length);
    }
  });
});

describe("isJunkSubject", () => {
  it("rejects machine tags and slugs", () => {
    // Captured from the real payload for The Ickabog.
    expect(isJunkSubject("nyt:childrens-middle-grade-hardcover=2020-11-29")).toBe(true);
    expect(isJunkSubject("series:Harry_Potter")).toBe(true);
    expect(isJunkSubject("https://example.com/x")).toBe(true);
  });

  it("rejects award and bestseller headings", () => {
    expect(isJunkSubject("Quill Award winner")).toBe(true);
    expect(isJunkSubject("Hugo Award")).toBe(true);
    expect(isJunkSubject("New York Times bestseller")).toBe(true);
    expect(isJunkSubject("New York Times reviewed")).toBe(true);
  });

  it("rejects values too short to be a genre", () => {
    expect(isJunkSubject("ron")).toBe(true);
    expect(isJunkSubject("war")).toBe(true);
  });

  it("keeps genuine genre headings", () => {
    expect(isJunkSubject("Juvenile fiction")).toBe(false);
    expect(isJunkSubject("Magic fiction")).toBe(false);
    expect(isJunkSubject("Horror stories")).toBe(false);
    expect(isJunkSubject("Wizards")).toBe(false);
  });
});

describe("normalizeSubjects with junk filtering", () => {
  it("drops the machine tags and keeps the genres", () => {
    const result = normalizeSubjects([
      "nyt:childrens-middle-grade-hardcover=2020-11-29",
      "series:Harry_Potter",
      "Juvenile fiction",
      "Wizards -- Juvenile fiction",
      "Hugo Award",
    ]);
    expect(result).toContain("Juvenile fiction");
    expect(result).toContain("Wizards");
    expect(result.some((s) => s.includes("nyt:"))).toBe(false);
    expect(result.some((s) => s.includes("Award"))).toBe(false);
  });
});