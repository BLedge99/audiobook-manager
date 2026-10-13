import { describe, it, expect } from "vitest";
import type { Audiobook } from "../types";
import { applySearch, describeSearch, matchesSearch, parseSearchQuery } from "./search";

/**
 * Spec 22 — typed search.
 *
 * The interesting cases are the ones that silently return nothing when wrong:
 * an unknown `field:`, a quoted value with spaces, and a typed facet that is a
 * substring rather than an exact facet value.
 */

function book(over: Partial<Audiobook> = {}): Audiobook {
  return {
    id: 1,
    title: "The Tell-Tale Heart",
    author: "Edgar Allan Poe",
    duration: 100,
    fileFormat: "mp3",
    tracks: [],
    createdAt: "2026-01-01",
    ...over,
  };
}

const rowling = book({
  id: 2,
  title: "Harry Potter and the Philosopher's Stone",
  author: "J.K. Rowling",
  narrator: "Stephen Fry",
  genres: [{ id: 1, slug: "fantasy", name: "Fantasy", source: "provider" }],
  customTags: [{ id: 1, name: "bedtime" }],
  description: "A boy discovers he is a wizard.",
});

const lovelace = book({
  id: 3,
  title: "The Lighthouse",
  author: "J.K. Rowling",
  genres: [{ id: 2, slug: "thriller", name: "Thriller", source: "provider" }],
  description: "A keeper tends a remote lighthouse.",
});

const dickens = book({
  id: 4,
  title: "A Christmas Carol",
  author: "Charles Dickens",
  narrator: "Simon Vance",
  series: { id: 1, name: "Ghost Stories" },
});

describe("parseSearchQuery", () => {
  it("treats bare words as free text", () => {
    expect(parseSearchQuery("dickens audiobook")).toEqual({
      terms: ["dickens", "audiobook"],
      facets: {},
      empty: false,
    });
  });

  it("parses field:value into facets", () => {
    expect(parseSearchQuery("author:Rowling genre:Thriller").facets).toEqual({
      author: ["Rowling"],
      genre: ["Thriller"],
    });
  });

  it("keeps a quoted value as one term", () => {
    const parsed = parseSearchQuery('author:"J.K. Rowling"');
    expect(parsed.facets.author).toEqual(["J.K. Rowling"]);
    expect(parsed.terms).toEqual([]);
  });

  it("tolerates whitespace around the colon", () => {
    // Regression: without `\\s*` the optional field group could not match
    // `author:` followed by a space and silently degraded to free text.
    expect(parseSearchQuery("author: rowling").facets).toEqual({ author: ["rowling"] });
    expect(parseSearchQuery("author : rowling").facets).toEqual({ author: ["rowling"] });
  });

  it("treats an unquoted multi-word value as a facet plus free text", () => {
    // `author:J.K. Rowling` is author~"J.K." AND anything~"Rowling". Forgiving,
    // but imprecise -- quoting is what scopes it to the author alone.
    const parsed = parseSearchQuery("author:J.K. Rowling");
    expect(parsed.facets.author).toEqual(["J.K."]);
    expect(parsed.terms).toEqual(["Rowling"]);
  });

  it("accepts single quotes too", () => {
    expect(parseSearchQuery("author:'J.K. Rowling'").facets.author).toEqual(["J.K. Rowling"]);
  });

  it("de-duplicates a repeated field case-insensitively", () => {
    expect(parseSearchQuery("author:A author:a").facets.author).toEqual(["A"]);
  });

  it("falls back to free text for an unknown field", () => {
    // Must not silently match nothing.
    const parsed = parseSearchQuery("isbn:12345");
    expect(parsed.facets).toEqual({});
    expect(parsed.terms).toEqual(["isbn:12345"]);
  });

  it("drops a field with no value", () => {
    expect(parseSearchQuery("author:").empty).toBe(true);
  });

  it("reports empty for whitespace and empty input", () => {
    expect(parseSearchQuery("").empty).toBe(true);
    expect(parseSearchQuery("   ").empty).toBe(true);
    expect(parseSearchQuery(null).empty).toBe(true);
    expect(parseSearchQuery(undefined).empty).toBe(true);
  });

  it("accepts aliases and any casing", () => {
    expect(parseSearchQuery("AUTHORS:x").facets.author).toEqual(["x"]);
    expect(parseSearchQuery("genres:y").facets.genre).toEqual(["y"]);
    expect(parseSearchQuery("tags:z").facets.tag).toEqual(["z"]);
  });
});

describe("matchesSearch", () => {
  it("matches an author by substring, not just exactly", () => {
    expect(matchesSearch(rowling, parseSearchQuery("author: rowling"))).toBe(true);
    expect(matchesSearch(lovelace, parseSearchQuery("author: rowling"))).toBe(true);
    expect(matchesSearch(dickens, parseSearchQuery("author: rowling"))).toBe(false);
  });

  it("filters by genre", () => {
    const thriller = parseSearchQuery("genre: Thriller");
    expect(matchesSearch(lovelace, thriller)).toBe(true);
    expect(matchesSearch(rowling, thriller)).toBe(false);
    expect(matchesSearch(dickens, thriller)).toBe(false);
  });

  it("matches a quoted author with spaces", () => {
    const parsed = parseSearchQuery('author:"J.K. Rowling"');
    expect(matchesSearch(rowling, parsed)).toBe(true);
    // Scoped strictly to the author: a book that merely *mentions* Rowling in
    // its description must not match.
    const mentioned = book({ id: 9, title: "Untitled", author: "Anon", description: "Mentions J.K. Rowling" });
    expect(matchesSearch(mentioned, parsed)).toBe(false);
  });

  it("ANDs multiple facets together", () => {
    expect(matchesSearch(lovelace, parseSearchQuery("author:rowling genre:thriller"))).toBe(true);
    expect(matchesSearch(rowling, parseSearchQuery("author:rowling genre:thriller"))).toBe(false);
  });

  it("ANDs bare terms together", () => {
    expect(matchesSearch(lovelace, parseSearchQuery("rowling lighthouse"))).toBe(true);
    expect(matchesSearch(lovelace, parseSearchQuery("rowling submarine"))).toBe(false);
  });

  it("searches title, narrator, series, tag and description", () => {
    expect(matchesSearch(rowling, parseSearchQuery("philosopher"))).toBe(true);
    expect(matchesSearch(dickens, parseSearchQuery("fry"))).toBe(false);
    expect(matchesSearch(dickens, parseSearchQuery("vance"))).toBe(true);
    expect(matchesSearch(dickens, parseSearchQuery("ghost stories"))).toBe(true);
    expect(matchesSearch(rowling, parseSearchQuery("bedtime"))).toBe(true);
    expect(matchesSearch(lovelace, parseSearchQuery("keeper"))).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(matchesSearch(rowling, parseSearchQuery("ROWLING"))).toBe(true);
    expect(matchesSearch(rowling, parseSearchQuery("GENRE:thriller"))).toBe(false);
    expect(matchesSearch(lovelace, parseSearchQuery("genre:THRILLER"))).toBe(true);
  });

  it("matches narrator through the contributor rows", () => {
    const multi = book({ contributors: [{ id: 1, name: "Scott Brick", role: "narrator" }] });
    expect(matchesSearch(multi, parseSearchQuery("narrator:brick"))).toBe(true);
    expect(matchesSearch(multi, parseSearchQuery("narrator:vance"))).toBe(false);
  });

  it("treats an empty query as matching everything", () => {
    expect(matchesSearch(dickens, parseSearchQuery(""))).toBe(true);
    expect(matchesSearch(dickens, parseSearchQuery("   "))).toBe(true);
  });
});

describe("applySearch", () => {
  const library = [rowling, lovelace, dickens];

  it("returns the input array untouched for an empty query", () => {
    expect(applySearch(library, "")).toBe(library);
    expect(applySearch(library, null)).toBe(library);
  });

  it("narrows by author", () => {
    expect(applySearch(library, "author: rowling").map((b) => b.id)).toEqual([2, 3]);
  });

  it("narrows by genre", () => {
    expect(applySearch(library, "genre: thriller").map((b) => b.id)).toEqual([3]);
  });

  it("can return nothing without erroring", () => {
    expect(applySearch(library, "author: nobody")).toEqual([]);
  });

  it("preserves library order", () => {
    // Matching books come back in the order they were given, not in the order
    // the query mentioned them.
    expect(applySearch(library, "author: rowling").map((b) => b.id)).toEqual([2, 3]);
    expect(applySearch([...library].reverse(), "author: rowling").map((b) => b.id)).toEqual([3, 2]);
  });
});

describe("describeSearch", () => {
  it("summarises facets and terms", () => {
    expect(describeSearch("author: rowling genre:thriller")).toBe("author: rowling · genre: thriller");
  });

  it("is empty for an empty query", () => {
    expect(describeSearch("")).toBe("");
    expect(describeSearch(null)).toBe("");
  });
});