import { describe, it, expect, vi, afterEach } from "vitest";
import { mapGoogleVolume, searchGoogleBooks } from "./googlebooks";

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

describe("searchGoogleBooks", () => {
  it("maps items to candidates", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      items: [{ volumeInfo: { title: "The Awakening", authors: ["Kate Chopin"], imageLinks: { thumbnail: "http://img" } } }],
    }), { status: 200 })));
    const results = await searchGoogleBooks("The Awakening");
    expect(results[0]).toMatchObject({ source: "googlebooks", title: "The Awakening", author: "Kate Chopin" });
    expect(results[0].coverUrl).toMatch(/^https:/);
  });

  it("returns [] when the API fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    expect(await searchGoogleBooks("x")).toEqual([]);
  });
});

afterEach(() => vi.unstubAllGlobals());
