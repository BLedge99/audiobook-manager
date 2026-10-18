import { describe, it, expect, vi, afterEach } from "vitest";
import {
  candidateCoverFilename,
  searchOpenLibrary,
  searchOpenLibraryBySubject,
  searchGoogleBooks,
  fetchOpenLibraryDescription,
  mapOpenLibraryDoc,
  mapGoogleVolume,
  normalizeSubjects,
  isJunkSubject,
  isNonBookTitle,
  pickLanguage,
  parseSeriesPosition,
  OPEN_LIBRARY_FIELDS,
} from "./enrichment";

/**
 * Spec 25 — catalogue field extraction.
 *
 * The fixtures here are real API shapes captured on 2026-10-13, including the
 * awkward ones: Open Library merges every edition of a work, so `language`
 * arrives as the set of languages the book was ever published in.
 */

describe("candidateCoverFilename", () => {
  it("includes the source and is a jpg", () => {
    expect(candidateCoverFilename("openlibrary", 7)).toMatch(/^openlibrary_7_\d+\.jpg$/);
    expect(candidateCoverFilename("googlebooks", 3)).toMatch(/^googlebooks_3_\d+\.jpg$/);
  });
});

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

describe("mapOpenLibraryDoc", () => {
  it("extracts every field spec 07 left on the table", () => {
    const mapped = mapOpenLibraryDoc({
      title: "Harry Potter and the Goblet of Fire",
      author_name: ["J. K. Rowling"],
      cover_i: 8750241,
      first_publish_year: 2000,
      subject: ["Magic fiction", "Wizards -- Juvenile fiction"],
      publisher: ["Bloomsbury Publishing"],
      isbn: ["9780747532699"],
      language: ["eng", "eng", "gre"],
      series_name: ["Harry Potter"],
      series_position: ["4"],
      key: "/works/OL45804W",
    });
    expect(mapped).toMatchObject({
      title: "Harry Potter and the Goblet of Fire",
      author: "J. K. Rowling",
      coverUrl: "https://covers.openlibrary.org/b/id/8750241-M.jpg",
      publishedYear: 2000,
      publisher: "Bloomsbury Publishing",
      isbn: "9780747532699",
      language: "eng",
      seriesName: "Harry Potter",
      seriesPosition: 4,
      genres: ["Magic fiction", "Wizards"],
      workKey: "/works/OL45804W",
    });
  });

  it("rejects an implausible publication year", () => {
    expect(mapOpenLibraryDoc({ title: "X", first_publish_year: 1200 }).publishedYear).toBeUndefined();
    expect(mapOpenLibraryDoc({ title: "X", first_publish_year: 3000 }).publishedYear).toBeUndefined();
  });

  it("survives an empty doc", () => {
    const mapped = mapOpenLibraryDoc({});
    expect(mapped.title).toBe("Unknown");
    expect(mapped.genres).toEqual([]);
    expect(mapped.seriesPosition).toBeUndefined();
  });
});

describe("mapGoogleVolume", () => {
  it("extracts categories, publisher, year, ISBN and language", () => {
    const mapped = mapGoogleVolume({
      title: "The Lighthouse",
      authors: ["Some Author"],
      categories: ["Juvenile Fiction", "Mystery fiction"],
      publisher: "Penguin",
      publishedDate: "2019-03-01",
      industryIdentifiers: [
        { type: "ISBN_13", identifier: "9781234567890" },
        { type: "OTHER", identifier: "xyz" },
      ],
      language: "en",
      description: "A keeper tends a light.",
      imageLinks: { thumbnail: "http://img/x.jpg" },
    });
    expect(mapped).toMatchObject({
      title: "The Lighthouse",
      publisher: "Penguin",
      publishedYear: 2019,
      isbn: "9781234567890",
      language: "en",
      description: "A keeper tends a light.",
      genres: ["Juvenile Fiction", "Mystery fiction"],
    });
    expect(mapped.coverUrl).toMatch(/^https:/);
  });

  it("ignores a year it cannot parse", () => {
    expect(mapGoogleVolume({ title: "X", publishedDate: "not-a-date" }).publishedYear).toBeUndefined();
  });
});

describe("OPEN_LIBRARY_FIELDS", () => {
  it("requests the fields that are otherwise absent", () => {
    // Without these, subject/publisher/isbn come back missing entirely.
    for (const field of ["subject", "publisher", "isbn", "series_name", "series_position"]) {
      expect(OPEN_LIBRARY_FIELDS).toContain(field);
    }
  });
});

describe("fetchOpenLibraryDescription", () => {
  it("handles both the bare-string and i18n shapes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ description: "A blurb." }), { status: 200 })));
    expect(await fetchOpenLibraryDescription("/works/OL1W")).toBe("A blurb.");

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ description: { type: "text", value: "Translated." } }), { status: 200 })));
    expect(await fetchOpenLibraryDescription("/works/OL1W")).toBe("Translated.");
  });

  it("refuses a work key that is not a work path", async () => {
    // Guards against the key being interpolated into an arbitrary URL.
    expect(await fetchOpenLibraryDescription("https://evil.example/x")).toBeUndefined();
    expect(await fetchOpenLibraryDescription("/books/OL1M")).toBeUndefined();
    expect(await fetchOpenLibraryDescription(undefined)).toBeUndefined();
  });

  it("returns undefined on failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    expect(await fetchOpenLibraryDescription("/works/OL1W")).toBeUndefined();
  });
});

afterEach(() => vi.unstubAllGlobals());

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

describe("search filtering", () => {
  it("drops study-guide spam from Open Library results", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      docs: [
        { title: "Summary of Harry Potter and the Deathly Hallows", author_name: ["Bookhabits"] },
        { title: "Harry Potter and the Deathly Hallows", author_name: ["J. K. Rowling"] },
      ],
    }), { status: 200 })));
    const results = await searchOpenLibrary("Harry Potter and the Deathly Hallows");
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Harry Potter and the Deathly Hallows");
  });

  it("searches by title alone, not title plus author", async () => {
    // Including the author measurably degraded results: "Harry Potter and the
    // Goblet of Fire J.K. Rowling" returned only study guides, while the title
    // alone returned the real novel with its series and position.
    let requested = "";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      requested = String(url);
      return new Response(JSON.stringify({ docs: [] }), { status: 200 });
    }));
    await searchOpenLibrary("Harry Potter and the Goblet of Fire", "J.K. Rowling");
    expect(requested).not.toContain("J.K.%20Rowling");
    expect(decodeURIComponent(requested)).toContain("q=Harry Potter and the Goblet of Fire");
  });

  it("asks for more results so filtering still leaves options", async () => {
    let requested = "";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      requested = String(url);
      return new Response(JSON.stringify({ docs: [] }), { status: 200 });
    }));
    await searchOpenLibrary("Anything");
    expect(requested).toContain("limit=10");
  });
});

describe("searchOpenLibrary", () => {
  it("maps results to candidates", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      docs: [{ title: "The Awakening", author_name: ["Kate Chopin"], cover_i: 123 }],
    }), { status: 200 })));
    const results = await searchOpenLibrary("The Awakening");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ source: "openlibrary", title: "The Awakening", author: "Kate Chopin", confidence: 1 });
    expect(results[0].coverUrl).toContain("covers.openlibrary.org");
  });

  it("returns [] when the API fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    expect(await searchOpenLibrary("x")).toEqual([]);
  });
});

describe("searchOpenLibraryBySubject", () => {
  it("queries by subject, not by title", async () => {
    let requested = "";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      requested = String(url);
      return new Response(JSON.stringify({ docs: [] }), { status: 200 });
    }));
    await searchOpenLibraryBySubject("horror");
    // The whole point of this function. A title search cannot answer "what else
    // is like this", and every other free provider here either cannot search at
    // all (Audnexus) or matches titles exactly (LibriVox).
    expect(decodeURIComponent(requested)).toContain("q=subject:horror");
  });

  it("maps docs to candidates with a flat confidence", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      docs: [{ key: "/works/OL1W", title: "The Shining", author_name: ["Stephen King"], cover_i: 9, subject: ["horror"] }],
    }), { status: 200 })));
    const results = await searchOpenLibraryBySubject("horror");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ source: "openlibrary", title: "The Shining", author: "Stephen King" });
    expect(results[0].coverUrl).toContain("covers.openlibrary.org");
    // A topical match, not a title match. Scoring it like a title similarity
    // would invent precision that was never measured.
    expect(results[0].confidence).toBe(0.5);
  });

  it("drops study-guide spam, which dominates popular subjects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      docs: [
        { title: "Summary of The Shining" },
        { title: "Guide to The Shining" },
        { title: "The Shining" },
      ],
    }), { status: 200 })));
    const results = await searchOpenLibraryBySubject("horror");
    expect(results.map((r) => r.title)).toEqual(["The Shining"]);
  });

  it("returns [] rather than throwing when the API fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    // Discover must degrade, not fail: one provider being down should cost
    // result quality, not the whole tab (spec 16's isolation rule).
    await expect(searchOpenLibraryBySubject("horror")).resolves.toEqual([]);
  });

  it("returns [] on a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 503 })));
    expect(await searchOpenLibraryBySubject("horror")).toEqual([]);
  });
});

describe("searchGoogleBooks", () => {
  it("maps items to candidates", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      items: [{ volumeInfo: { title: "The Awakening", authors: ["Kate Chopin"], imageLinks: { thumbnail: "http://img" } } }],
    }), { status: 200 })));
    const results = await searchGoogleBooks("The Awakening");
    expect(results[0]).toMatchObject({ source: "googlebooks", title: "The Awakening", author: "Kate Chopin" });
    expect(results[0].coverUrl).toMatch(/^https:/);
  });
});
