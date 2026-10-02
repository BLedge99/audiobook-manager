import { describe, it, expect, vi, afterEach } from "vitest";
import { candidateCoverFilename, searchOpenLibrary, searchGoogleBooks } from "./enrichment";

describe("candidateCoverFilename", () => {
  it("includes the source and is a jpg", () => {
    expect(candidateCoverFilename("openlibrary", 7)).toMatch(/^openlibrary_7_\d+\.jpg$/);
    expect(candidateCoverFilename("googlebooks", 3)).toMatch(/^googlebooks_3_\d+\.jpg$/);
  });
});

afterEach(() => vi.unstubAllGlobals());

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
