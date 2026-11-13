/**
 * Spec 39 / ADR 034 — the one server-side lookup for the "Free" row.
 *
 * Fixtures are captured shapes from the live LibriVox API (2026-11-13):
 * the author= search is how LibriVox exposes servers to us, because title=
 * is exact-anchored and store titles often drop the leading "The".
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  findLibrivoxMatch,
  clearBuyContextCache,
  normaliseLookupTitle,
  lastAuthorToken,
} from "./buy-context";

const WILDE_PAGE = {
  books: [
    {
      id: "71",
      title: "Canterville Ghost",
      authors: [{ first_name: "Oscar", last_name: "Wilde" }],
      url_librivox: "https://librivox.org/canterville-ghost-version-3/",
    },
    {
      id: "365",
      title: "Picture of Dorian Gray",
      authors: [{ first_name: "Oscar", last_name: "Wilde" }],
      url_librivox: "https://librivox.org/picture-of-dorian-gray-version-3/",
      url_rss: "https://librivox.org/rss/16395",
    },
  ],
};
const WILDE_PAGE_RSS_ONLY = {
  books: [
    {
      id: "16395",
      title: "Picture of Dorian Gray",
      authors: [{ first_name: "Oscar", last_name: "Wilde" }],
      url_rss: "https://librivox.org/rss/16395",
    },
  ],
};

function stubFetch(body: unknown, status = 200) {
  const spy = vi.fn(async (_url: unknown) =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

beforeEach(() => {
  clearBuyContextCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("normaliseLookupTitle", () => {
  it("drops a leading article and punctuation", () => {
    expect(normaliseLookupTitle("The Picture of Dorian Gray")).toBe("picture of dorian gray");
  });
  it("keeps internal articles but normalises case and diacritics", () => {
    expect(normaliseLookupTitle("The Count of Monte-Cristo!")).toBe("count of monte cristo");
    expect(normaliseLookupTitle("Café Über Alles")).toBe("cafe uber alles");
  });
});

describe("lastAuthorToken", () => {
  it("returns the last word", () => {
    expect(lastAuthorToken("Oscar Wilde")).toBe("Wilde");
  });
  it("returns undefined for empty input", () => {
    expect(lastAuthorToken("")).toBeUndefined();
    expect(lastAuthorToken("   ")).toBeUndefined();
  });
});

describe("findLibrivoxMatch", () => {
  it("matches a store title that carries a leading 'The'", async () => {
    stubFetch(WILDE_PAGE);
    const match = await findLibrivoxMatch({ title: "The Picture of Dorian Gray", author: "Oscar Wilde" });
    expect(match).toMatchObject({
      id: "365",
      url: "https://librivox.org/picture-of-dorian-gray-version-3/",
    });
  });

  it("matches when the store and LibriVox both drop the article", async () => {
    stubFetch(WILDE_PAGE);
    const match = await findLibrivoxMatch({ title: "Picture of Dorian Gray", author: "Oscar Wilde" });
    expect(match?.id).toBe("365");
  });

  it("rejects the right title by the wrong author", async () => {
    stubFetch({
      books: [
        {
          id: "1",
          title: "Picture of Dorian Gray",
          authors: [{ first_name: "Someone", last_name: "Else" }],
          url_librivox: "https://librivox.org/x/",
        },
      ],
    });
    const match = await findLibrivoxMatch({ title: "The Picture of Dorian Gray", author: "Oscar Wilde" });
    expect(match).toBeNull();
  });

  it("returns null when the author is unknown — no guessing", async () => {
    const spy = stubFetch(WILDE_PAGE);
    const match = await findLibrivoxMatch({ title: "The Picture of Dorian Gray", author: undefined });
    expect(match).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("requests by author's last token, never by title", async () => {
    const spy = stubFetch(WILDE_PAGE);
    await findLibrivoxMatch({ title: "The Picture of Dorian Gray", author: "Oscar Wilde" });
    const url = String(spy.mock.calls[0][0]);
    expect(url).toContain("author=Wilde");
    expect(url).not.toContain("title=");
  });

  it("falls back to url_rss when url_librivox is absent", async () => {
    stubFetch(WILDE_PAGE_RSS_ONLY);
    const match = await findLibrivoxMatch({ title: "Picture of Dorian Gray", author: "Oscar Wilde" });
    expect(match?.url).toBe("https://librivox.org/rss/16395");
  });

  it("returns null on upstream 500", async () => {
    stubFetch("nope", 500);
    expect(await findLibrivoxMatch({ title: "X", author: "Oscar Wilde" })).toBeNull();
  });

  it("returns null on network error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    expect(await findLibrivoxMatch({ title: "X", author: "Oscar Wilde" })).toBeNull();
  });

  it("returns null on an empty result", async () => {
    stubFetch({ books: [] });
    expect(await findLibrivoxMatch({ title: "X", author: "Oscar Wilde" })).toBeNull();
  });

  it("caches a result for five minutes", async () => {
    const spy = stubFetch(WILDE_PAGE);
    await findLibrivoxMatch({ title: "Dorian Gray", author: "Wilde" });
    await findLibrivoxMatch({ title: "Dorian Gray", author: "Wilde" });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("different authors do not share a cache entry", async () => {
    const spy = stubFetch(WILDE_PAGE);
    await findLibrivoxMatch({ title: "Dorian Gray", author: "Wilde" });
    await findLibrivoxMatch({ title: "Dorian Gray", author: "Balzac" });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("cache expires after five minutes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-13T12:00:00Z"));
    const spy = stubFetch(WILDE_PAGE);
    await findLibrivoxMatch({ title: "Dorian Gray", author: "Wilde" });
    vi.setSystemTime(new Date("2026-11-13T12:06:00Z"));
    await findLibrivoxMatch({ title: "Dorian Gray", author: "Wilde" });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("survives a malformed JSON body", async () => {
    stubFetch("<not json>", 200);
    expect(await findLibrivoxMatch({ title: "X", author: "Oscar Wilde" })).toBeNull();
  });
});
