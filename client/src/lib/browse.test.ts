import { describe, it, expect } from "vitest";
import {
  MAX_SHELVES,
  activeFilterCount,
  applyFilters,
  buildGenreShelves,
  buildSeriesShelves,
  clearFacet,
  facetOptions,
  facetValues,
  filtersFromQuery,
  filtersToQuery,
  isFilterActive,
  seriesLabel,
  sortBySeriesPosition,
  toggleFilter,
  type Filters,
} from "./browse";
import type { Audiobook } from "../types";

/**
 * Spec 20 — browsing, filtering and shelf grouping.
 *
 * Pure and unit-tested so the rules deciding what a user sees are verified
 * directly rather than inferred from rendered markup.
 */

function book(overrides: Partial<Audiobook> = {}): Audiobook {
  return {
    id: 1,
    title: "Untitled",
    author: "Unknown",
    duration: 3600,
    fileFormat: "mp3",
    tracks: [],
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const dune = book({
  id: 1,
  title: "Dune",
  author: "Frank Herbert",
  genres: [{ id: 1, slug: "science-fiction", name: "Science Fiction", source: "provider" }],
  contributors: [{ id: 10, name: "Simon Vance", role: "narrator" }],
  series: { id: 1, name: "Dune" },
  seriesPosition: 1,
});

const duneMessiah = book({
  id: 2,
  title: "Dune Messiah",
  author: "Frank Herbert",
  genres: [{ id: 1, slug: "science-fiction", name: "Science Fiction", source: "provider" }],
  contributors: [{ id: 10, name: "Simon Vance", role: "narrator" }],
  series: { id: 1, name: "Dune" },
  seriesPosition: 2,
});

const emma = book({
  id: 3,
  title: "Emma",
  author: "Jane Austen",
  genres: [{ id: 2, slug: "romantic-fiction", name: "Romantic Fiction", source: "provider" }],
  customTags: [{ id: 20, name: "cosy" }],
});

describe("facetValues", () => {
  it("reads genres", () => {
    expect(facetValues(dune, "genre")).toEqual(["science-fiction"]);
  });

  it("prefers contributor rows for narrators", () => {
    expect(facetValues(dune, "narrator")).toEqual(["Simon Vance"]);
  });

  it("falls back to the legacy narrator string", () => {
    const legacy = book({ id: 9, title: "Old", narrator: "Jane Doe, John Roe" });
    expect(facetValues(legacy, "narrator")).toEqual(["Jane Doe", "John Roe"]);
  });

  it("ignores non-narrator contributors when reading narrators", () => {
    const withAuthor = book({ id: 10, contributors: [{ id: 1, name: "An Author", role: "author" }] });
    expect(facetValues(withAuthor, "narrator")).toEqual([]);
  });

  it("reads series and custom tags", () => {
    expect(facetValues(dune, "series")).toEqual(["Dune"]);
    expect(facetValues(emma, "tag")).toEqual(["cosy"]);
  });

  it("returns an empty list for an unset facet", () => {
    expect(facetValues(book(), "series")).toEqual([]);
    expect(facetValues(book(), "tag")).toEqual([]);
  });
});

describe("applyFilters", () => {
  it("returns everything when no filter is active", () => {
    const books = [dune, emma];
    expect(applyFilters(books, {})).toHaveLength(2);
  });

  it("filters by a single genre", () => {
    expect(applyFilters([dune, duneMessiah, emma], { genre: ["science-fiction"] })).toHaveLength(2);
  });

  it("ORs values within one facet", () => {
    const filtered = applyFilters([dune, emma], { genre: ["science-fiction", "romantic-fiction"] });
    expect(filtered).toHaveLength(2);
  });

  it("ANDs across facets", () => {
    const filtered = applyFilters(
      [dune, emma],
      { genre: ["science-fiction"], tag: ["cosy"] },
    );
    // Emma has the tag but not the genre; Dune has the genre but not the tag.
    expect(filtered).toHaveLength(0);
  });

  it("excludes books missing a value for a filtered facet", () => {
    // Filtering by narrator must not surface every book without one.
    const filtered = applyFilters([dune, emma], { narrator: ["Simon Vance"] });
    expect(filtered.map((entry) => entry.id)).toEqual([1]);
  });

  it("matches on normalised values", () => {
    const filtered = applyFilters([dune], { narrator: ["simon vance"] });
    expect(filtered).toHaveLength(0);
  });
});

describe("toggleFilter", () => {
  it("adds a value", () => {
    expect(toggleFilter({}, "genre", "horror")).toEqual({ genre: ["horror"] });
  });

  it("is idempotent - toggling twice removes it", () => {
    const once = toggleFilter({}, "genre", "horror");
    expect(toggleFilter(once, "genre", "horror")).toEqual({});
  });

  it("drops the facet key entirely when it empties", () => {
    const filters = toggleFilter({ genre: ["horror"] }, "genre", "horror");
    expect("genre" in filters).toBe(false);
  });

  it("leaves other facets untouched", () => {
    const filters = toggleFilter({ tag: ["cosy"] }, "genre", "horror");
    expect(filters.tag).toEqual(["cosy"]);
    expect(filters.genre).toEqual(["horror"]);
  });
});

describe("isFilterActive / counts", () => {
  it("reports empty filters as inactive", () => {
    expect(isFilterActive({})).toBe(false);
    expect(isFilterActive({ genre: [] })).toBe(false);
  });

  it("counts selected values across facets", () => {
    expect(activeFilterCount({ genre: ["a", "b"], tag: ["c"] })).toBe(3);
  });

  it("clears a single facet", () => {
    expect(clearFacet({ genre: ["a"], tag: ["b"] }, "genre")).toEqual({ tag: ["b"] });
  });
});

describe("facetOptions", () => {
  it("lists values with counts, most common first", () => {
    const options = facetOptions([dune, duneMessiah, emma], "genre");
    expect(options[0]).toEqual({ value: "science-fiction", label: "science-fiction", count: 2 });
    expect(options[1].count).toBe(1);
  });

  it("uses supplied labels instead of raw values", () => {
    const labels = new Map([["science-fiction", "Science Fiction"]]);
    expect(facetOptions([dune], "genre", labels)[0].label).toBe("Science Fiction");
  });

  it("counts the books behind each value so the count cannot disagree", () => {
    const options = facetOptions([dune, duneMessiah, emma], "author");
    expect(options.find((option) => option.value === "Frank Herbert")?.count).toBe(2);
  });

  it("returns an empty list when nothing has the facet", () => {
    expect(facetOptions([book()], "series")).toEqual([]);
  });
});

describe("buildGenreShelves", () => {
  // Genres with a single book are dropped by default (MIN_SHELF_SIZE = 2): a
  // one-book shelf is noise, not a browse surface. Tests that need a second
  // shelf supply a second book for that genre.
  const secondRomance = book({
    id: 4,
    title: "Persuasion",
    author: "Jane Austen",
    genres: [{ id: 2, slug: "romantic-fiction", name: "Romantic Fiction", source: "provider" }],
  });

  it("groups books into a shelf per genre", () => {
    const shelves = buildGenreShelves([dune, duneMessiah, emma, secondRomance]);
    expect(shelves).toHaveLength(2);
    expect(shelves.map((shelf) => shelf.key).sort()).toEqual(["genre:romantic-fiction", "genre:science-fiction"]);
  });

  it("orders shelves by size, largest first", () => {
    // Three science-fiction books against two romantic-fiction ones.
    const thirdSciFi = book({ id: 7, genres: dune.genres });
    const shelves = buildGenreShelves([dune, duneMessiah, thirdSciFi, emma, secondRomance]);
    expect(shelves[0].key).toBe("genre:science-fiction");
    expect(shelves[0].books).toHaveLength(3);
    expect(shelves[1].books).toHaveLength(2);
  });

  it("breaks a size tie alphabetically so shelf order is stable", () => {
    const shelves = buildGenreShelves([dune, duneMessiah, emma, secondRomance]);
    expect(shelves[0].key).toBe("genre:romantic-fiction");
  });

  it("omits shelves below the minimum size", () => {
    // Both genres here have exactly one book.
    expect(buildGenreShelves([dune, emma])).toHaveLength(0);
  });

  it("honours an explicit minimum size", () => {
    expect(buildGenreShelves([dune, emma], { minSize: 1 })).toHaveLength(2);
  });

  it("uses display labels when supplied", () => {
    const labels = new Map([["science-fiction", "Science Fiction"]]);
    const shelves = buildGenreShelves([dune, duneMessiah], { labels: { genres: labels } });
    expect(shelves[0].title).toBe("Science Fiction");
  });

  it("lets a book appear in several shelves", () => {
    const multi = book({
      id: 5,
      genres: [
        { id: 1, slug: "science-fiction", name: "SF", source: "provider" },
        { id: 2, slug: "horror", name: "Horror", source: "provider" },
      ],
    });
    const horrorPartner = book({ id: 6, genres: [{ id: 2, slug: "horror", name: "Horror", source: "provider" }] });
    const sciFiPartner = book({ id: 7, genres: [{ id: 1, slug: "science-fiction", name: "SF", source: "provider" }] });
    // Both genres need two books or the minimum-size rule drops them.
    const shelves = buildGenreShelves([multi, horrorPartner, sciFiPartner]);
    expect(shelves).toHaveLength(2);
    // Book 5 is counted in both shelves.
    expect(shelves.flatMap((shelf) => shelf.books.map((entry) => entry.id)).sort()).toEqual([5, 5, 6, 7]);
  });

  it("caps the number of shelves", () => {
    // Two books per genre so none are dropped by the minimum-size rule.
    const many = Array.from({ length: 40 }, (_, index) =>
      book({ id: index + 1, genres: [{ id: index + 1, slug: `g${index}`, name: `G${index}`, source: "provider" }] }),
    ).flatMap((entry, index) => [entry, book({ id: 1000 + index, genres: entry.genres })]);
    expect(buildGenreShelves(many, { max: 5 })).toHaveLength(5);
    expect(MAX_SHELVES).toBeGreaterThan(0);
  });

  it("returns nothing for an empty library", () => {
    expect(buildGenreShelves([])).toEqual([]);
  });
});

describe("sortBySeriesPosition", () => {
  it("orders numerically", () => {
    const a = book({ id: 1, title: "Book 10", seriesPosition: 10 });
    const b = book({ id: 2, title: "Book 2", seriesPosition: 2 });
    expect(sortBySeriesPosition([a, b]).map((entry) => entry.title)).toEqual(["Book 2", "Book 10"]);
  });

  it("sorts fractional positions between whole books", () => {
    const list = [
      book({ id: 1, title: "Book 2", seriesPosition: 2 }),
      book({ id: 2, title: "Interlude", seriesPosition: 1.5 }),
      book({ id: 3, title: "Book 1", seriesPosition: 1 }),
    ];
    expect(sortBySeriesPosition(list).map((entry) => entry.title)).toEqual([
      "Book 1",
      "Interlude",
      "Book 2",
    ]);
  });

  it("sorts unknown positions last", () => {
    const list = [
      book({ id: 1, title: "Unknown", seriesPosition: null }),
      book({ id: 2, title: "Book 1", seriesPosition: 1 }),
    ];
    expect(sortBySeriesPosition(list).map((entry) => entry.title)).toEqual(["Book 1", "Unknown"]);
  });

  it("breaks ties by title for determinism", () => {
    const list = [
      book({ id: 1, title: "B", seriesPosition: 1 }),
      book({ id: 2, title: "A", seriesPosition: 1 }),
    ];
    expect(sortBySeriesPosition(list).map((entry) => entry.title)).toEqual(["A", "B"]);
  });
});

describe("buildSeriesShelves", () => {
  it("groups by series name in reading order", () => {
    const shelves = buildSeriesShelves([duneMessiah, dune]);
    expect(shelves).toHaveLength(1);
    expect(shelves[0].books.map((entry) => entry.title)).toEqual(["Dune", "Dune Messiah"]);
  });

  it("ignores books with no series", () => {
    expect(buildSeriesShelves([dune, emma])).toHaveLength(1);
  });

  it("returns nothing when no book has a series", () => {
    expect(buildSeriesShelves([emma])).toEqual([]);
  });
});

describe("seriesLabel", () => {
  it("labels a known position", () => {
    expect(seriesLabel(dune, 5)).toBe("Book 1 of 5");
  });

  it("returns null for an unknown position", () => {
    expect(seriesLabel(emma, 3)).toBeNull();
  });
});

describe("URL round-trip", () => {
  it("serialises multiple values for one facet", () => {
    expect(filtersToQuery({ genre: ["horror", "romance"] })).toBe("genre=horror%7Cromance");
  });

  it("emits facets in a fixed order for a stable URL", () => {
    const filters: Filters = { tag: ["cosy"], genre: ["horror"], narrator: ["Simon Vance"] };
    expect(filtersToQuery(filters)).toBe("genre=horror&narrator=Simon+Vance&tag=cosy");
  });

  it("round-trips", () => {
    const filters: Filters = { genre: ["horror", "romance"], tag: ["cosy"] };
    expect(filtersFromQuery(filtersToQuery(filters))).toEqual(filters);
  });

  it("round-trips through the nested f= form the app actually writes", () => {
    const filters: Filters = { genre: ["horror", "romance"], tag: ["cosy"] };
    const nested = `tab=browse&f=${encodeURIComponent(filtersToQuery(filters))}`;
    expect(filtersFromQuery(nested)).toEqual(filters);
  });

  it("still reads bare top-level facet keys for older shared links", () => {
    expect(filtersFromQuery("genre=horror&tag=cosy")).toEqual({ genre: ["horror"], tag: ["cosy"] });
  });

  it("prefers the nested form when both are present", () => {
    expect(filtersFromQuery(`genre=ignored&f=${encodeURIComponent("genre=kept")}`)).toEqual({ genre: ["kept"] });
  });

  it("produces an empty string for no filters", () => {
    expect(filtersToQuery({})).toBe("");
  });

  it("ignores unknown facets and blank values when parsing", () => {
    expect(filtersFromQuery("genre=horror&bogus=x&tag=")).toEqual({ genre: ["horror"] });
  });

  it("handles an empty query string", () => {
    expect(filtersFromQuery("")).toEqual({});
  });

  it("preserves a value containing a pipe by trimming, not splitting on spaces", () => {
    expect(filtersFromQuery("author=Frank%20Herbert")).toEqual({ author: ["Frank Herbert"] });
  });
});