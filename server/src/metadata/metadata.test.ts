import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  looksLikeLibriVox,
  resolveProviderOrder,
  runChain,
  selectCoverSource,
  DEFAULT_CONFIDENCE_THRESHOLD,
} from "./chain";
import {
  normalizeText,
  scoreMatch,
  similarity,
  trimDescription,
  shouldAutoApply,
  AUTO_APPLY_FLOOR,
  AUTO_APPLY_STRONG,
  type MetadataProvider,
  type ProviderCandidate,
  type ProviderId,
} from "./types";
import { mapLibrivoxBook, titleVariants } from "./librivox";
import { mapAudnexusBook, mapAudnexusGenres, parseSequence } from "./audnexus";
import { isPublicCoverUrl, coverFilename } from "./cover";
import { rowToCandidate, dedupeCandidates } from "./apply";

/**
 * Spec 16 — provider chain tests.
 *
 * These are the pure, network-free parts of the feature: provider ordering,
 * early stop, failure isolation, and the mapping/scoring helpers. Provider
 * HTTP behaviour is covered by the `search()` tests further down.
 */

function fakeProvider(id: ProviderId, candidates: ProviderCandidate[]): MetadataProvider {
  return {
    id,
    supportsRichFields: true,
    search: vi.fn(async () => candidates),
  };
}

describe("normalizeText", () => {
  it("lowercases, strips punctuation and collapses whitespace", () => {
    expect(normalizeText("The  Time-Traveler's Wife!")).toBe("the time traveler s wife");
  });

  it("strips diacritics so accented titles match unaccented ones", () => {
    expect(normalizeText("Les Misérables")).toBe("les miserables");
  });

  it("treats null and empty as empty", () => {
    expect(normalizeText(null)).toBe("");
    expect(normalizeText(undefined)).toBe("");
  });
});

describe("similarity", () => {
  it("scores identical strings 1", () => {
    expect(similarity("Dune", "Dune")).toBe(1);
  });

  it("scores a substring match high but not perfect", () => {
    expect(similarity("Dune", "Dune Messiah")).toBe(0.8);
  });

  it("scores unrelated strings low", () => {
    expect(similarity("Dune", "The Hobbit")).toBeLessThan(0.2);
  });
});

describe("scoreMatch", () => {
  it("is title-only when the author is unknown", () => {
    const query = { title: "Dune", author: "Unknown author", authorIsUnknown: true };
    expect(scoreMatch(query, "Dune", "Frank Herbert")).toBe(1);
  });

  it("boosts a match whose author also agrees", () => {
    const query = { title: "Dune", author: "Frank Herbert" };
    const withAuthor = scoreMatch(query, "Dune", "Frank Herbert");
    const withoutAuthor = scoreMatch(query, "Dune", "Someone Else");
    expect(withAuthor).toBeGreaterThan(withoutAuthor);
    expect(withAuthor).toBeLessThanOrEqual(1);
  });

  it("never lets a wrong author rescue a completely different title", () => {
    const query = { title: "Dune", author: "Frank Herbert" };
    expect(scoreMatch(query, "The Hobbit", "Frank Herbert")).toBe(0);
  });
});

describe("trimDescription", () => {
  it("returns undefined for empty input", () => {
    expect(trimDescription(null)).toBeUndefined();
  });

  it("collapses whitespace", () => {
    expect(trimDescription("a\n\n  b")).toBe("a b");
  });

  it("truncates on a word boundary and marks the cut", () => {
    const result = trimDescription("word ".repeat(300), 50);
    expect(result).toBeDefined();
    expect(result!.length).toBeLessThanOrEqual(51);
    expect(result!.endsWith("…")).toBe(true);
    // Must not leave a partial word before the ellipsis.
    expect(result!.slice(0, -1).trim().split(" ").every((w) => w === "word")).toBe(true);
  });

  it("leaves short text untouched", () => {
    expect(trimDescription("short", 600)).toBe("short");
  });
});

describe("looksLikeLibriVox (ADR 008 detection)", () => {
  it("detects a librivox.org path", () => {
    expect(looksLikeLibriVox({ title: "Anything", filePath: "/books/librivox.org/x.mp3" })).toBe(true);
  });

  it("detects the LibriVox project folder naming", () => {
    expect(looksLikeLibriVox({ title: "12_creepytales_1206_librivox" })).toBe(true);
  });

  it("detects an explicit public-domain hint", () => {
    expect(looksLikeLibriVox({ title: "Dune", hintText: "Public Domain Audio" })).toBe(true);
  });

  it("treats an ordinary commercial-looking title as not LibriVox", () => {
    expect(looksLikeLibriVox({ title: "Project Hail Mary", filePath: "/audiobooks/hailmary.m4b" })).toBe(false);
  });
});

describe("resolveProviderOrder", () => {
  afterEach(() => {
    delete process.env.METADATA_PROVIDER_ORDER;
  });

  it("puts LibriVox first for a LibriVox recording", () => {
    expect(resolveProviderOrder({ title: "12_creepytales_1206_librivox" })[0]).toBe("librivox");
  });

  it("puts LibriVox first for a LibriVox recording", () => {
    expect(resolveProviderOrder({ title: "12_creepytales_1206_librivox" })[0]).toBe("librivox");
  });

  it("keeps Audnexus out of the search chain (ADR 011)", () => {
    // Audnexus cannot search by title, so including it would only ever spend a
    // guaranteed-404 request per book.
    expect(resolveProviderOrder({ title: "Project Hail Mary", filePath: "/a/b.m4b" })).not.toContain("audnexus");
    expect(resolveProviderOrder({ title: "creepy tales librivox" })).not.toContain("audnexus");
  });

  it("honours a METADATA_PROVIDER_ORDER override", () => {
    process.env.METADATA_PROVIDER_ORDER = "openlibrary,googlebooks";
    const order = resolveProviderOrder({ title: "12_creepytales_1206_librivox" });
    expect(order.slice(0, 2)).toEqual(["openlibrary", "googlebooks"]);
  });

  it("appends omitted providers so none become unreachable", () => {
    process.env.METADATA_PROVIDER_ORDER = "openlibrary";
    expect(resolveProviderOrder({ title: "x" }).length).toBeGreaterThan(1);
  });

  it("ignores a malformed override rather than losing every provider", () => {
    process.env.METADATA_PROVIDER_ORDER = "nonsense";
    expect(resolveProviderOrder({ title: "x" }).length).toBeGreaterThan(1);
  });
});

describe("runChain", () => {
  const query = { title: "Dune", author: "Frank Herbert" };

  it("stops at the first provider that clears the threshold", async () => {
    const good = fakeProvider("librivox", [{ source: "librivox", title: "Dune", confidence: 1 }]);
    const later = fakeProvider("googlebooks", [{ source: "googlebooks", title: "Dune", confidence: 1 }]);
    const providers = {
      audnexus: fakeProvider("audnexus", []),
      librivox: good,
      googlebooks: later,
      openlibrary: fakeProvider("openlibrary", []),
    } as Record<ProviderId, MetadataProvider>;

    const result = await runChain({ title: "dune_librivox" }, { providers, threshold: 0.9 });

    expect(result.best?.source).toBe("librivox");
    expect(later.search).not.toHaveBeenCalled();
  });

  it("continues to the next provider when the first is below threshold", async () => {
    const weak = fakeProvider("librivox", [{ source: "librivox", title: "Dune", confidence: 0.4 }]);
    const better = fakeProvider("googlebooks", [{ source: "googlebooks", title: "Dune", confidence: 0.95 }]);
    const providers = {
      audnexus: fakeProvider("audnexus", []),
      librivox: weak,
      googlebooks: better,
      openlibrary: fakeProvider("openlibrary", []),
    } as Record<ProviderId, MetadataProvider>;

    const result = await runChain({ title: "dune_librivox" }, { providers, threshold: 0.9 });
    expect(result.best?.source).toBe("googlebooks");
  });

  it("isolates a throwing provider and still returns results", async () => {
    const boom: MetadataProvider = {
      id: "librivox",
      supportsRichFields: true,
      search: vi.fn(async () => {
        throw new Error("provider unreachable");
      }),
    };
    const healthy = fakeProvider("googlebooks", [{ source: "googlebooks", title: "Dune", confidence: 1 }]);
    const providers = {
      audnexus: fakeProvider("audnexus", []),
      librivox: boom,
      googlebooks: healthy,
      openlibrary: fakeProvider("openlibrary", []),
    } as Record<ProviderId, MetadataProvider>;

    const result = await runChain({ title: "dune_librivox" }, { providers, threshold: 0.9 });
    expect(result.best?.source).toBe("googlebooks");
  });

  it("walks the whole chain when nothing clears the threshold", async () => {
    const providers = {
      audnexus: fakeProvider("audnexus", []),
      librivox: fakeProvider("librivox", []),
      googlebooks: fakeProvider("googlebooks", []),
      openlibrary: fakeProvider("openlibrary", []),
    } as Record<ProviderId, MetadataProvider>;

    const result = await runChain({ title: "dune_librivox" }, { providers, threshold: 0.9 });
    expect(result.best).toBeNull();
    // Audnexus is not walked (ADR 011); the other three are.
    expect(result.walked).not.toContain("audnexus");
    expect(result.walked).toHaveLength(3);
  });

  it("collects every provider's candidates for the review queue", async () => {
    const providers = {
      audnexus: fakeProvider("audnexus", []),
      librivox: fakeProvider("librivox", [{ source: "librivox", title: "B", confidence: 0.1 }]),
      googlebooks: fakeProvider("googlebooks", [{ source: "googlebooks", title: "A", confidence: 0.2 }]),
      openlibrary: fakeProvider("openlibrary", []),
    } as Record<ProviderId, MetadataProvider>;

    const result = await runChain({ title: "dune_librivox" }, { providers, threshold: 0.9, collectAll: true });
    expect(result.candidates).toHaveLength(2);
    // Sorted by confidence descending.
    expect(result.candidates[0].source).toBe("googlebooks");
  });

  it("returns nothing rather than throwing when every provider is down", async () => {
    const down: MetadataProvider = {
      id: "audnexus",
      supportsRichFields: true,
      search: vi.fn(async () => {
        throw new Error("offline");
      }),
    };
    const providers = {
      audnexus: down,
      librivox: down,
      googlebooks: down,
      openlibrary: down,
    } as unknown as Record<ProviderId, MetadataProvider>;

    const result = await runChain(query, { providers, threshold: 0.9 });
    expect(result.best).toBeNull();
    expect(result.candidates).toEqual([]);
  });
});

describe("LibriVox titleVariants", () => {
  it("keeps the original title as the first variant", () => {
    expect(titleVariants("Awakening")[0]).toBe("Awakening");
  });

  it("strips the trailing _librivox marker", () => {
    expect(titleVariants("awakening_librivox")).toContain("awakening");
  });

  it("strips trailing catalogue numbers", () => {
    expect(titleVariants("absoluteevil_2608_librivox")).toContain("absoluteevil");
  });

  it("strips a leading catalogue number", () => {
    expect(titleVariants("12_creepytales_1206_librivox")).toContain("creepytales");
  });

  it("produces a space-separated variant for provider exact-match lookups", () => {
    expect(titleVariants("12_creepytales_1206_librivox")).toContain("creepy tales".replace("creepy tales", "creepytales"));
    expect(titleVariants("ghohor034_1907_librivox")).toContain("ghohor034");
  });

  it("drops a leading article, which LibriVox omits from its titles", () => {
    expect(titleVariants("The Awakening")).toContain("Awakening");
  });

  it("returns nothing usable for an empty title", () => {
    expect(titleVariants("   ")).toEqual([]);
  });

  it("never returns a variant shorter than two characters", () => {
    for (const variant of titleVariants("ab_12_librivox")) {
      expect(variant.length).toBeGreaterThan(1);
    }
  });
});

describe("LibriVox mapping", () => {
  const query = { title: "Frankenstein", author: "Mary Shelley" };

  it("maps authors, year, language and genres", () => {
    const candidate = mapLibrivoxBook(
      {
        id: "12345",
        title: "Frankenstein",
        description: "A modern Prometheus.",
        language: "English",
        copyright_year: 1818,
        authors: [{ first_name: "Mary", last_name: "Shelley" }],
        genres: [{ name: "Horror" }, { name: "Gothic" }],
      },
      query,
    );
    expect(candidate).not.toBeNull();
    expect(candidate!.providerKey).toBe("12345");
    expect(candidate!.author).toBe("Mary Shelley");
    expect(candidate!.publishedYear).toBe(1818);
    expect(candidate!.genres).toEqual(["Horror", "Gothic"]);
    expect(candidate!.confidence).toBe(1);
  });

  it("derives narrators from per-section readers", () => {
    const candidate = mapLibrivoxBook(
      {
        id: "1",
        title: "Frankenstein",
        authors: [{ name: "Mary Shelley" }],
        sections: [
          { readers: [{ name: "Tom Chivers" }] },
          { readers: [{ name: "Thomas A. Copeland" }] },
          // Same reader on two sections must not be duplicated.
          { readers: [{ name: "Tom Chivers" }] },
        ],
      },
      query,
    );
    expect(candidate!.narrators).toEqual(["Tom Chivers", "Thomas A. Copeland"]);
  });

  it("reads section readers from display_name and strips the life span", () => {
    // The live API returns readers only as `display_name`, e.g.
    // "Kara Shallenberg (1969-2023)". Reading first/last only silently
    // produced zero narrators until a live run caught it.
    const candidate = mapLibrivoxBook(
      {
        id: "600",
        title: "Awakening",
        authors: [{ first_name: "Kate", last_name: "Chopin" }],
        sections: [
          { readers: [{ display_name: "Kara Shallenberg (1969-2023)" }] },
          { readers: [{ display_name: "Aria Robinson" }] },
        ],
      },
      query,
    );
    expect(candidate!.narrators).toEqual(["Kara Shallenberg", "Aria Robinson"]);
  });

  it("rejects a book with no title", () => {
    expect(mapLibrivoxBook({ id: "1" }, query)).toBeNull();
  });
});

describe("Audnexus mapping", () => {
  const query = { title: "Dune", author: "Frank Herbert" };

  it("folds the subtitle back into the title for honest comparison", () => {
    const candidate = mapAudnexusBook({ asin: "B0024LZ1P6", title: "Dune", subtitle: "Book One" }, query);
    expect(candidate!.title).toBe("Dune: Book One");
  });

  it("maps series name and fractional position", () => {
    const candidate = mapAudnexusBook(
      { asin: "A1", title: "Dune", seriesPrimary: { name: "Dune", sequence: "1.5" } },
      query,
    );
    expect(candidate!.seriesName).toBe("Dune");
    expect(candidate!.seriesPosition).toBe(1.5);
  });

  it("maps narrators and derives the cover url with a size suffix", () => {
    const candidate = mapAudnexusBook(
      { asin: "A1", title: "Dune", narrators: [{ name: "Simon Vance" }], image: "https://cdn.audnex.us/books/A1.jpg" },
      query,
    );
    expect(candidate!.narrators).toEqual(["Simon Vance"]);
    expect(candidate!.coverUrl).toBe("https://cdn.audnex.us/books/A1-M.jpg");
  });

  it("keeps parent genres and sub-genre tags distinct", () => {
    // Audnexus puts both in the same array, separated only by `type`.
    const genres = mapAudnexusGenres({
      genres: [
        { name: "Science Fiction", type: "genre" },
        { name: "Adventure", type: "tag" },
      ],
    });
    expect(genres).toEqual(["Science Fiction", "Adventure"]);
  });

  it("does not drop a genre that carries no explicit type", () => {
    const genres = mapAudnexusGenres({
      genres: [{ name: "Mystery, Thriller & Suspense" }, { name: "Hard Science Fiction", type: "tag" }],
    });
    expect(genres).toContain("Mystery, Thriller & Suspense");
    expect(genres).toContain("Hard Science Fiction");
  });

  it("parses the release year defensively", () => {
    expect(parseSequence("2")).toBe(2);
    expect(parseSequence("not-a-number")).toBeUndefined();
    expect(parseSequence(undefined)).toBeUndefined();
  });

  it("rejects a book with no title", () => {
    expect(mapAudnexusBook({ asin: "A1" }, query)).toBeNull();
  });
});

describe("isPublicCoverUrl (spec 11 / SSRF guard)", () => {
  it("accepts ordinary https provider CDNs", () => {
    expect(isPublicCoverUrl("https://covers.openlibrary.org/b/id/1-M.jpg")).toBe(true);
    expect(isPublicCoverUrl("https://cdn.audnex.us/books/A1.jpg")).toBe(true);
  });

  it("rejects non-http schemes", () => {
    expect(isPublicCoverUrl("file:///etc/passwd")).toBe(false);
    expect(isPublicCoverUrl("gopher://example.com")).toBe(false);
  });

  it("rejects localhost and .local names", () => {
    expect(isPublicCoverUrl("http://localhost/cover.jpg")).toBe(false);
    expect(isPublicCoverUrl("http://nas.local/cover.jpg")).toBe(false);
  });

  it("rejects private, loopback and link-local addresses", () => {
    expect(isPublicCoverUrl("http://127.0.0.1/cover.jpg")).toBe(false);
    expect(isPublicCoverUrl("http://10.1.2.3/cover.jpg")).toBe(false);
    expect(isPublicCoverUrl("http://192.168.1.10/cover.jpg")).toBe(false);
    expect(isPublicCoverUrl("http://172.16.5.5/cover.jpg")).toBe(false);
    expect(isPublicCoverUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
  });

  it("rejects garbage", () => {
    expect(isPublicCoverUrl("not a url")).toBe(false);
    expect(isPublicCoverUrl("")).toBe(false);
  });
});

describe("coverFilename", () => {
  it("sanitises the identifier into a single safe path segment", () => {
    const name = coverFilename("audnexus", "../../etc/passwd");
    expect(name).not.toContain("/");
    expect(name).not.toContain("..");
  });
});

describe("rowToCandidate", () => {
  it("decodes the JSON-encoded list columns", () => {
    const candidate = rowToCandidate({
      source: "audnexus",
      title: "Dune",
      author: "Frank Herbert",
      coverUrl: null,
      description: null,
      confidence: 0.95,
      narrators: '["Simon Vance"]',
      seriesName: "Dune",
      seriesPosition: 1,
      publisher: "Penguin",
      publishedYear: 1965,
      language: "English",
      genres: '["Science Fiction"]',
    });
    expect(candidate.narrators).toEqual(["Simon Vance"]);
    expect(candidate.genres).toEqual(["Science Fiction"]);
    expect(candidate.confidence).toBe(0.95);
  });

  it("survives malformed JSON rather than throwing", () => {
    const candidate = rowToCandidate({
      source: "librivox",
      title: "Dune",
      author: null,
      coverUrl: null,
      description: null,
      confidence: null,
      narrators: "{not json",
      seriesName: null,
      seriesPosition: null,
      publisher: null,
      publishedYear: null,
      language: null,
      genres: null,
    });
    expect(candidate.narrators).toEqual([]);
    expect(candidate.genres).toEqual([]);
    expect(candidate.confidence).toBe(0);
  });
});

describe("provider HTTP clients (mocked fetch)", () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("Audnexus returns [] on a non-OK response rather than throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    const { AudnexusProvider } = await import("./audnexus");
    expect(await new AudnexusProvider().search({ title: "Dune" })).toEqual([]);
  });

  it("Audnexus returns [] when the network throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const { AudnexusProvider } = await import("./audnexus");
    expect(await new AudnexusProvider().search({ title: "Dune" })).toEqual([]);
  });

  it("Audnexus maps a well-formed response", async () => {
    // Audnexus has no title search; /books/{ASIN} is the real entry point, so
    // the query must carry an ASIN.
    const book = {
      asin: "B0024LZ1P6",
      title: "Dune",
      authors: [{ name: "Frank Herbert", asin: "B000AP9A6K" }],
      narrators: [{ name: "Simon Vance" }],
      genres: [{ name: "Science Fiction", type: "genre" }],
      publisherName: "Penguin",
      releaseDate: "2007-02-01",
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(book), { status: 200 })));
    const { AudnexusProvider } = await import("./audnexus");
    const [candidate] = await new AudnexusProvider().search({ title: "Dune", author: "Frank Herbert", asin: "B0024LZ1P6" });
    expect(candidate.title).toBe("Dune");
    expect(candidate.narrators).toEqual(["Simon Vance"]);
    expect(candidate.publishedYear).toBe(2007);
    expect(candidate.confidence).toBe(1);
  });

  it("Audnexus makes no request at all without an ASIN", async () => {
    // Guards against regressing to a title search that 404s: with no ASIN the
    // provider must not touch the network.
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { AudnexusProvider } = await import("./audnexus");
    expect(await new AudnexusProvider().search({ title: "Dune" })).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Audnexus maps official chapter titles from the free chapters endpoint", async () => {
    const chapters = {
      asin: "B08G9PRS1K",
      isAccurate: true,
      chapters: [
        { title: "Opening Credits", startOffsetSec: 0, lengthMs: 13307 },
        { title: "Chapter 1", startOffsetSec: 19, lengthMs: 2203908 },
      ],
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(chapters), { status: 200 })));
    const { AudnexusProvider } = await import("./audnexus");
    const result = await new AudnexusProvider().chaptersByAsin("B08G9PRS1K");
    expect(result.isAccurate).toBe(true);
    expect(result.chapters.map((c) => c.title)).toEqual(["Opening Credits", "Chapter 1"]);
    expect(result.chapters[1].startOffsetSec).toBe(19);
  });

  it("Audnexus chapters degrade to empty when unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    const { AudnexusProvider } = await import("./audnexus");
    expect(await new AudnexusProvider().chaptersByAsin("B000000000")).toEqual({ chapters: [], isAccurate: false });
  });

  it("Audnexus uses the corrected api host, not audnex.us", async () => {
    const seen: string[] = [];
    const fetchMock = vi.fn(async (url: unknown) => {
      seen.push(String(url));
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    const { AudnexusProvider } = await import("./audnexus");
    await new AudnexusProvider().chaptersByAsin("B08G9PRS1K");
    // The original implementation used audnex.us/books?title=, which 404s on
    // every path and silently disabled the whole provider.
    expect(seen[0]).toContain("https://api.audnex.us/");
  });

  it("LibriVox returns [] when the network throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const { LibrivoxProvider } = await import("./librivox");
    expect(await new LibrivoxProvider().search({ title: "Frankenstein" })).toEqual([]);
  });

  it("LibriVox sorts candidates by confidence", async () => {
    const body = {
      books: [
        { id: "1", title: "Something Else Entirely", authors: [{ name: "Nobody" }] },
        { id: "2", title: "Frankenstein", authors: [{ name: "Mary Shelley" }] },
      ],
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
    const { LibrivoxProvider } = await import("./librivox");
    const results = await new LibrivoxProvider().search({ title: "Frankenstein", author: "Mary Shelley" });
    expect(results[0].title).toBe("Frankenstein");
  });
});

describe("auto-apply threshold", () => {
  it("defaults to 0.9", () => {
    expect(DEFAULT_CONFIDENCE_THRESHOLD).toBe(0.9);
  });
});

/**
 * Spec 25 — the banded auto-apply rule.
 *
 * The floor was lowered because a 0.9 floor left 7 of 12 fixture books in the
 * review queue. But `scoreMatch` is ~85% title-weighted, so a merely-similar
 * title scores nearly as well even with a disagreeing author. These tests pin
 * the guard that stops the lowered floor auto-applying the wrong book.
 */
/**
 * Spec 25 — candidate de-duplication.
 *
 * Searching by title returns editions of a work, so several candidates collapse
 * to the same (source, providerKey). Storing them all violated the unique
 * constraint and failed the whole item: "The Ickabog" failed exactly that way
 * and was the only regression in an otherwise large coverage gain.
 */
describe("dedupeCandidates", () => {
  const cand = (
    source: ProviderId,
    title: string,
    author: string | undefined,
    confidence: number,
    providerKey?: string,
  ): ProviderCandidate => ({ source, title, author, confidence, providerKey });

  it("collapses editions of the same work", () => {
    // Five editions, identical normalised title and author.
    const editions = [0.9, 0.85, 0.8, 0.7, 0.6].map((c) => cand("openlibrary", "The Ickabog", "J.K. Rowling", c));
    expect(dedupeCandidates(editions)).toHaveLength(1);
  });

  it("keeps the highest-confidence edition", () => {
    const editions = [0.7, 0.95, 0.8].map((c) => cand("openlibrary", "The Ickabog", "J.K. Rowling", c));
    const [kept] = dedupeCandidates(editions);
    expect(kept.confidence).toBe(0.95);
  });

  it("keeps different works apart", () => {
    const result = dedupeCandidates([
      cand("openlibrary", "Book A", "Author", 0.9),
      cand("openlibrary", "Book B", "Author", 0.8),
    ]);
    expect(result).toHaveLength(2);
  });

  it("keeps providers apart", () => {
    const result = dedupeCandidates([
      cand("openlibrary", "Same Title", "Same Author", 0.9),
      cand("librivox", "Same Title", "Same Author", 0.8),
    ]);
    expect(result).toHaveLength(2);
  });

  it("respects an explicit provider key", () => {
    const result = dedupeCandidates([
      cand("audnexus", "A", "B", 0.9, "B00X"),
      cand("audnexus", "C", "D", 0.8, "B00Y"),
    ]);
    expect(result).toHaveLength(2);
  });

  it("handles an empty list", () => {
    expect(dedupeCandidates([])).toEqual([]);
  });
});

describe("shouldAutoApply", () => {
  const query = { title: "Some Book", author: "J. K. Rowling", authorIsUnknown: false };

  it("keeps the old behaviour at and above the strong bar", () => {
    expect(shouldAutoApply(1, query, "J. K. Rowling")).toBe(true);
    expect(shouldAutoApply(0.95, query, "J. K. Rowling")).toBe(true);
    // Above the strong bar even a disagreeing author passes, as before.
    expect(shouldAutoApply(0.9, query, "Someone Else")).toBe(true);
  });

  it("still rejects anything below the floor", () => {
    expect(shouldAutoApply(AUTO_APPLY_FLOOR - 0.01, query, "J. K. Rowling")).toBe(false);
    expect(shouldAutoApply(0.4, query, "J. K. Rowling")).toBe(false);
    expect(shouldAutoApply(0, query, "J. K. Rowling")).toBe(false);
  });

  it("accepts the band when the author agrees", () => {
    expect(shouldAutoApply(0.8, query, "J. K. Rowling")).toBe(true);
    expect(shouldAutoApply(AUTO_APPLY_FLOOR, query, "J. K. Rowling")).toBe(true);
  });

  it("rejects the band when the author disagrees", () => {
    // The exact failure a bare floor drop would cause: a similar title by a
    // different author.
    expect(shouldAutoApply(0.8, query, "Suzanne Collins")).toBe(false);
    expect(shouldAutoApply(0.75, query, "Nobody At All")).toBe(false);
  });

  it("accepts the band on an exact title even when the author differs", () => {
    // LibriVox collections list a narrator or compiler as the file's author
    // while the provider records "Various". Two exact-title matches in the
    // fixture library were rejected for exactly this reason.
    const q = { title: "Short Ghost and Horror Collection 034", author: "Myla Jo Closser" };
    expect(shouldAutoApply(0.85, q, "Various", "Short Ghost and Horror Collection 034")).toBe(true);
  });

  it("still applies the author rule when the title differs", () => {
    const q = { title: "Collected Poems", author: "A Poet" };
    expect(shouldAutoApply(0.85, q, "Various", "Short Ghost and Horror Collection 034")).toBe(false);
  });

  it("accepts the band when no author can contradict the match", () => {
    expect(shouldAutoApply(0.8, { title: "T", author: undefined, authorIsUnknown: false }, "Anyone")).toBe(true);
    expect(shouldAutoApply(0.8, { title: "T", author: "X", authorIsUnknown: true }, "Anyone")).toBe(true);
    expect(shouldAutoApply(0.8, query, undefined)).toBe(true);
  });

  it("exposes a floor below the strong bar", () => {
    expect(AUTO_APPLY_FLOOR).toBeLessThan(AUTO_APPLY_STRONG);
  });
});

/**
 * Spec 23 — cover art is chosen independently of which candidate won.
 *
 * The live library had 0 covers on 6 books. The cause was not a failed
 * download: LibriVox's feed exposes no cover-art field and Audnexus has been
 * ASIN-keyed since ADR 011, so the candidate that matched the title could
 * never supply a cover and the chain threw the other candidates' artwork away.
 */
describe("selectCoverSource", () => {
  const candidate = (
    source: ProviderId,
    confidence: number,
    coverUrl?: string,
    providerKey?: string,
  ): ProviderCandidate => ({ source, title: "T", confidence, coverUrl, providerKey });

  it("returns null when no candidate has a cover", () => {
    expect(selectCoverSource([candidate("librivox", 1), candidate("openlibrary", 0.8)])).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(selectCoverSource([])).toBeNull();
  });

  it("picks the highest-confidence candidate that actually has a cover", () => {
    const result = selectCoverSource([
      candidate("librivox", 1.0), // winner, but no cover field at all
      candidate("openlibrary", 0.8, "https://covers.openlibrary.org/b/id/1-M.jpg", "OL1W"),
      candidate("googlebooks", 0.6, "https://books.google.com/t.jpg", "GB1"),
    ]);
    expect(result).toEqual({
      url: "https://covers.openlibrary.org/b/id/1-M.jpg",
      source: "openlibrary",
      identifier: "OL1W",
    });
  });

  it("ignores confidence ordering when the winner does have a cover", () => {
    // Called only when the winner has none, but the function must still be
    // self-contained and order-independent.
    const result = selectCoverSource([
      candidate("googlebooks", 0.6, "https://books.google.com/t.jpg", "GB1"),
      candidate("librivox", 1.0, "https://librivox/cover.jpg", "LV1"),
    ]);
    expect(result?.source).toBe("librivox");
  });

  it("does not treat an empty cover url as a cover", () => {
    expect(selectCoverSource([candidate("openlibrary", 1, "")])).toBeNull();
  });

  it("carries the provider key so the filename records where art came from", () => {
    const result = selectCoverSource([candidate("googlebooks", 0.5, "https://x/y.jpg", "abc123")]);
    expect(result?.identifier).toBe("abc123");
  });
});