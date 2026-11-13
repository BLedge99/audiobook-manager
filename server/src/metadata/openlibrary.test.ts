import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  clearSubjectPoolCache,
  searchOpenLibrary,
  searchOpenLibraryBySubject,
  fetchOpenLibraryDescription,
  mapOpenLibraryDoc,
  OPEN_LIBRARY_FIELDS,
} from "./openlibrary";

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
      providerKey: "/works/OL45804W",
    });
  });

  it("carries a providerKey, so the candidate can be wishlisted", () => {
    // POST /api/wishlist requires providerKey. Open Library recommendations
    // used to arrive without one — the schema answered 400 FST_ERR_VALIDATION
    // every time, so "Save to wishlist" was a no-op on the phone.
    expect(mapOpenLibraryDoc({ title: "X", key: "/works/OL45804W" }).providerKey).toBe("/works/OL45804W");
    expect(mapOpenLibraryDoc({ title: "X" }).providerKey).toBeUndefined();
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
    // Including the author measurably degraded results.
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
  beforeEach(() => clearSubjectPoolCache());

  it("queries by subject, not by title", async () => {
    let requested = "";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      requested = String(url);
      return new Response(JSON.stringify({ docs: [] }), { status: 200 });
    }));
    await searchOpenLibraryBySubject("horror");
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
    await expect(searchOpenLibraryBySubject("horror")).resolves.toEqual([]);
  });

  it("returns [] on a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 503 })));
    expect(await searchOpenLibraryBySubject("horror")).toEqual([]);
  });

  it("asks for a specific page, because 'load more' needs a cursor", async () => {
    let requested = "";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      requested = String(url);
      return new Response(JSON.stringify({ docs: [] }), { status: 200 });
    }));
    await searchOpenLibraryBySubject("horror", { limit: 50, page: 2 });
    expect(requested).toContain("page=2");
    expect(requested).toContain("limit=50");
  });

  it("identifies itself, which earns 3x the rate limit", async () => {
    let headers: Record<string, string> = {};
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: { headers?: Record<string, string> }) => {
      headers = init?.headers ?? {};
      return new Response(JSON.stringify({ docs: [] }), { status: 200 });
    }));
    await searchOpenLibraryBySubject("horror");
    expect(headers["User-Agent"]).toMatch(/Bookle/);
  });

  it("gives a hung provider a deadline instead of waiting forever", async () => {
    let init: { signal?: AbortSignal } | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, options?: { signal?: AbortSignal }) => {
      init = options;
      throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    }));
    await expect(searchOpenLibraryBySubject("horror")).resolves.toEqual([]);
    expect(init?.signal).toBeDefined();
  });

  it("serves a repeated page from cache rather than re-fetching", async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify({
      docs: [{ key: "/works/OL1W", title: "The Shining", subject: ["horror"] }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", spy);

    await searchOpenLibraryBySubject("horror", { limit: 50, page: 1 });
    await searchOpenLibraryBySubject("horror", { limit: 50, page: 1 });
    expect(spy).toHaveBeenCalledTimes(1);

    // A different page is a different question, so it is not served from cache.
    await searchOpenLibraryBySubject("horror", { limit: 50, page: 2 });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("never caches a failed page, so an outage does not blank Discover for 30 minutes", async () => {
    const spy = vi.fn(async () => new Response("nope", { status: 503 }));
    vi.stubGlobal("fetch", spy);
    await searchOpenLibraryBySubject("horror", { limit: 50, page: 1 });
    await searchOpenLibraryBySubject("horror", { limit: 50, page: 1 });
    // A failure is not an answer.
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
