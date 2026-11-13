/**
 * Phase 1 — store registry & URL parser. Every case below is a behaviour,
 * not a coverage filler; the names are the spec.
 */
import { describe, it, expect, vi } from "vitest";
import {
  EXTERNAL_STORES,
  parseStoreUrl,
  deslug,
} from "./externalStores";

const audible = (host: string, slug = "Some-Book", asin = "B08G9PRS1K") =>
  `https://${host}/pd/${slug}/${asin}`;
const playBook = (path: string, id = "AQAAAACf3Vbd2M") =>
  `https://play.google.com/store/${path}?id=${id}`;
const kobo = (region: string, lang: string, slug = "turtles-all-the-way-down-4") =>
  `https://www.kobo.com/${region}/${lang}/audiobook/${slug}`;
const librofm = (isbn: string, slug = "fourth-wing") =>
  `https://libro.fm/audiobooks/${isbn}-${slug}`;

describe("EXTERNAL_STORES registry", () => {
  it("exposes exactly the four v1 stores", () => {
    expect(Object.keys(EXTERNAL_STORES).sort()).toEqual(["audible", "kobo", "librofm", "playbooks"]);
  });

  it("every store has a label, an install URL and a search builder", () => {
    for (const store of Object.values(EXTERNAL_STORES)) {
      expect(store.label.length).toBeGreaterThan(0);
      expect(store.installUrl).toMatch(/^https:\/\//);
      expect(store.searchUrl("a b & c")).toContain("a%20b%20%26%20c");
    }
  });

  it("is frozen against accidental mutation", () => {
    expect(Object.isFrozen(EXTERNAL_STORES)).toBe(true);
  });

  it("Audible's install URL is its Play Store listing, not a book", () => {
    expect(EXTERNAL_STORES.audible.installUrl).toContain("com.audible.application");
  });
});

describe("parseStoreUrl — Audible", () => {
  const regions = [
    "www.audible.com",
    "audible.com",
    "www.audible.co.uk",
    "audible.co.uk",
    "www.audible.ca",
    "www.audible.de",
    "www.audible.fr",
    "www.audible.it",
    "www.audible.es",
    "www.audible.com.au",
    "www.audible.com.br",
  ];

  it.each(regions)("accepts /pd/<slug>/<ASIN> on %s", (host) => {
    const result = parseStoreUrl(audible(host));
    expect(result).toMatchObject({ ok: true, store: "audible", externalId: "B08G9PRS1K" });
  });

  it("keeps the regional host in the canonical httpsUrl", () => {
    const result = parseStoreUrl(audible("www.audible.co.uk", "An-Estate", "B00S2LTCQK"));
    expect(result).toMatchObject({ ok: true, httpsUrl: "https://www.audible.co.uk/pd/An-Estate/B00S2LTCQK" });
  });

  it("ignores affiliate/query params but keeps the ASIN path", () => {
    const result = parseStoreUrl(`${audible("www.audible.com")}?tag=someone-20&source=copy`);
    expect(result).toMatchObject({ ok: true, httpsUrl: "https://www.audible.com/pd/Some-Book/B08G9PRS1K" });
  });

  it("extracts a deslugged title hint", () => {
    const result = parseStoreUrl(audible("www.audible.com", "The-Count-of-Monte-Cristo-Audiobook", "B00S2LTCQK"));
    expect(result).toMatchObject({ titleHint: "the count of monte cristo audiobook" });
  });

  it("rejects non-product audible paths", () => {
    for (const raw of [
      "https://www.audible.com/dp/B08G9PRS1K",
      "https://www.audible.com/search?keywords=dorian",
      "https://www.audible.com/pd/",
      "https://www.audible.com/adbl_benefit/pdf/somewhere",
    ]) {
      expect(parseStoreUrl(raw)).toEqual({ ok: false, code: "unrecognised-shape" });
    }
  });

  it("rejects ASINs of the wrong length or charset", () => {
    for (const asin of ["B08G9PRS", "B08G9PRS1KK", "b08g9prs1k", "B08G9PRS1!"]) {
      expect(parseStoreUrl(audible("www.audible.com", "Some-Book", asin))).toEqual({
        ok: false,
        code: "unrecognised-shape",
      });
    }
  });
});

describe("parseStoreUrl — Google Play Books", () => {
  it("accepts the audiobooks details path", () => {
    const result = parseStoreUrl(playBook("audiobooks/details"));
    expect(result).toMatchObject({ ok: true, store: "playbooks", externalId: "AQAAAACf3Vbd2M" });
  });

  it("accepts the ebooks details path (same store, same id space)", () => {
    expect(parseStoreUrl(playBook("books/details", "LSylyYw5RzwC"))).toMatchObject({
      ok: true,
      store: "playbooks",
      externalId: "LSylyYw5RzwC",
    });
  });

  it("keeps only the id param, dropping hl/ct noise", () => {
    const result = parseStoreUrl(`${playBook("audiobooks/details")}&hl=en_US&ct=books`);
    expect(result).toMatchObject({ httpsUrl: "https://play.google.com/store/audiobooks/details?id=AQAAAACf3Vbd2M" });
  });

  it("rejects play.google.com pages without an id", () => {
    expect(parseStoreUrl("https://play.google.com/store/search?q=dorian")).toEqual({
      ok: false,
      code: "unrecognised-shape",
    });
    expect(parseStoreUrl("https://play.google.com/store/audiobooks/details")).toEqual({
      ok: false,
      code: "unrecognised-shape",
    });
  });

  it("rejects a book id that carries path traversal", () => {
    expect(parseStoreUrl(playBook("audiobooks/details", "../x"))).toEqual({
      ok: false,
      code: "unrecognised-shape",
    });
  });
});

describe("parseStoreUrl — Kobo", () => {
  it("accepts region/lang audiobook pages and strips query noise", () => {
    const result = parseStoreUrl(`${kobo("us", "en")}?utm_campaign=x`);
    expect(result).toMatchObject({ ok: true, store: "kobo", externalId: "turtles-all-the-way-down-4" });
  });

  it.each([["us", "en"], ["uk", "en"], ["ca", "fr"], ["de", "de"], ["au", "en"]])(
    "accepts region %s lang %s",
    (region, lang) => {
      expect(parseStoreUrl(kobo(region, lang))).toMatchObject({ ok: true, store: "kobo" });
    },
  );

  it("rejects ebook pages and malformed locales", () => {
    expect(parseStoreUrl("https://www.kobo.com/us/en/ebook/turtles-all-the-way-down")).toEqual({
      ok: false,
      code: "unrecognised-shape",
    });
    expect(parseStoreUrl("https://www.kobo.com/audiobook/something")).toEqual({
      ok: false,
      code: "unrecognised-shape",
    });
    expect(parseStoreUrl("https://www.kobo.com/USA/en/audiobook/turtles")).toEqual({
      ok: false,
      code: "unrecognised-shape",
    });
  });
});

describe("parseStoreUrl — Libro.fm", () => {
  it("accepts an ISBN-13 product page", () => {
    const result = parseStoreUrl(librofm("9781705085059"));
    expect(result).toMatchObject({ ok: true, store: "librofm", externalId: "9781705085059" });
  });

  it("rejects a bad ISBN-13 check digit", () => {
    expect(parseStoreUrl(librofm("9781705085058"))).toEqual({ ok: false, code: "unrecognised-shape" });
  });

  it("rejects an ISBN-10 (we only key on 13)", () => {
    expect(parseStoreUrl(librofm("1705085057"))).toEqual({ ok: false, code: "unrecognised-shape" });
  });

  it("ignores the slug entirely for identity", () => {
    expect(parseStoreUrl(librofm("9781705085059", "whatever"))).toMatchObject({
      externalId: "9781705085059",
    });
  });
});

describe("parseStoreUrl — cross-cutting", () => {
  it.each([
    ["javascript:alert(1)", "invalid-url"],
    ["not a url", "invalid-url"],
    ["", "invalid-url"],
    ["   ", "invalid-url"],
    ["https://example.com/pd/Some-Book/B08G9PRS1K", "unsupported-host"],
    ["https://librivox.org/picture-of-dorian-gray/", "unsupported-host"],
    ["https://www.amazon.com/Some-Book-dp/dp/B08G9PRS1K", "unsupported-host"],
    ["ftp://www.audible.com/pd/x/B08G9PRS1K", "invalid-url"],
  ])("parseStoreUrl(%j) → %s", (raw, code) => {
    expect(parseStoreUrl(raw)).toEqual({ ok: false, code });
  });

  it("upgrades http:// to https:// rather than refusing", () => {
    expect(parseStoreUrl("http://www.audible.com/pd/Some-Book/B08G9PRS1K")).toMatchObject({
      ok: true,
      httpsUrl: "https://www.audible.com/pd/Some-Book/B08G9PRS1K",
    });
  });

  it("never throws on hostile input", () => {
    for (const raw of ["<>{}\\0", "ht tp://a b", "https://user:pass@www.audible.com/pd/x/B08G9PRS1K", "https://%20"]) {
      expect(() => parseStoreUrl(raw)).not.toThrow();
    }
  });

  it("the credential-bearing URL still parses but the canonical one does not carry it", () => {
    expect(parseStoreUrl("https://user:pass@www.audible.com/pd/x/B08G9PRS1K")).toMatchObject({
      httpsUrl: "https://www.audible.com/pd/x/B08G9PRS1K",
    });
  });

  it("makes no network calls", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    parseStoreUrl("https://www.audible.com/pd/x/B08G9PRS1K");
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("deslug", () => {
  it("normalises hyphens and collapse whitespace", () => {
    expect(deslug("the-picture--of-dorian-gray")).toBe("the picture of dorian gray");
  });

  it("lowercases and trims", () => {
    expect(deslug("The-Count-of-Monte-Cristo")).toBe("the count of monte cristo");
  });
});
