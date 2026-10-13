import { describe, it, expect } from "vitest";
import {
  isBetterChapterTitle,
  isPlaceholderTitle,
  matchChaptersToTracks,
  parseTrackTitleOverrides,
  resolveTrackTitle,
  stripTrackNumberPrefix,
  trackTitleOverrideField,
} from "./chapters";
import { mapLibrivoxSections } from "./librivox";
import { extractAsin } from "./audnexus";
import type { ProviderChapter } from "./types";

/**
 * Spec 21 — official chapter titles.
 *
 * The matching rules are the risky part: matching by position is what silently
 * mislabels every chapter after a book is re-encoded or reordered, so the
 * misalignment cases get the most attention here.
 */

function tracks(...titles: { file: string; title?: string }[]) {
  return titles.map((entry, index) => ({
    id: index + 1,
    filePath: `/lib/book/${entry.file}`,
    title: entry.title,
  }));
}

describe("stripTrackNumberPrefix", () => {
  it("removes a leading number and separator", () => {
    expect(stripTrackNumberPrefix("01 - THE TELL-TALE HEART")).toBe("THE TELL-TALE HEART");
    expect(stripTrackNumberPrefix("12. The Fall of the House of Usher")).toBe("The Fall of the House of Usher");
    expect(stripTrackNumberPrefix("03_Title Here")).toBe("Title Here");
    expect(stripTrackNumberPrefix("(4) Another")).toBe("Another");
  });

  it("leaves a title with no leading number alone", () => {
    expect(stripTrackNumberPrefix("At the Gate")).toBe("At the Gate");
  });

  it("does not eat a leading number that is part of the title", () => {
    expect(stripTrackNumberPrefix("2001 A Space Odyssey")).toBe("2001 A Space Odyssey");
  });

  it("does not strip a bare number", () => {
    expect(stripTrackNumberPrefix("42")).toBe("42");
  });
});

describe("isPlaceholderTitle", () => {
  it("recognises titles carrying no information", () => {
    expect(isPlaceholderTitle("Section 01")).toBe(true);
    expect(isPlaceholderTitle("chapter 3")).toBe(true);
    expect(isPlaceholderTitle("Track 12")).toBe(true);
    expect(isPlaceholderTitle("Part 2")).toBe(true);
    expect(isPlaceholderTitle("")).toBe(true);
    expect(isPlaceholderTitle(null)).toBe(true);
  });

  it("does not treat a real title as a placeholder", () => {
    expect(isPlaceholderTitle("The Tell-Tale Heart")).toBe(false);
    // "Chapters I thru IV" is LibriVox's real name, not a placeholder.
    expect(isPlaceholderTitle("Chapters I thru IV")).toBe(false);
  });
});

describe("isBetterChapterTitle", () => {
  it("accepts an official name over a placeholder", () => {
    expect(isBetterChapterTitle("Section 01", "Chapters I-V")).toBe(true);
  });

  it("accepts an official name over a redundant number prefix", () => {
    expect(isBetterChapterTitle("01 - Chapters I thru IV", "Chapters I thru IV")).toBe(true);
  });

  it("reports no change when the title is already exactly right", () => {
    // Keeps a repeated enrichment pass a genuine no-op rather than a rewrite
    // of every correct row.
    expect(isBetterChapterTitle("Chapters I thru IV", "Chapters I thru IV")).toBe(false);
    expect(isBetterChapterTitle("chapters i thru iv", "Chapters I thru IV")).toBe(false);
  });

  it("rejects a generic provider name over a descriptive embedded one", () => {
    // The important guard: never step backwards to "Chapter 3".
    expect(isBetterChapterTitle("The Tell-Tale Heart", "Chapter 3")).toBe(false);
  });

  it("accepts anything when there is nothing there", () => {
    expect(isBetterChapterTitle(null, "Anything")).toBe(true);
    expect(isBetterChapterTitle("", "Anything")).toBe(true);
  });

  it("accepts a more descriptive provider title", () => {
    expect(isBetterChapterTitle("Speech: 1842, Boston", "Speech: February 1842, Boston")).toBe(true);
  });
});

describe("matchChaptersToTracks", () => {
  const chapters = (files: string[]): ProviderChapter[] =>
    files.map((file, index) => ({ title: `Chapter ${index + 1}`, fileName: file }));

  it("matches by filename identity, not position", () => {
    const result = matchChaptersToTracks(
      tracks({ file: "a.mp3", title: "First" }, { file: "b.mp3", title: "Second" }),
      chapters(["b.mp3", "a.mp3"]),
    );
    // Provider order is reversed relative to file order; identity wins.
    expect(result.get(1)).toBe("Chapter 2");
    expect(result.get(2)).toBe("Chapter 1");
  });

  it("does not mislabel when only some files can be matched", () => {
    // Two provider chapters, three tracks: counts disagree, so positional
    // matching is refused entirely rather than guessing.
    const result = matchChaptersToTracks(
      tracks({ file: "a.mp3", title: "One" }, { file: "b.mp3", title: "Two" }, { file: "c.mp3", title: "Three" }),
      chapters(["a.mp3", "b.mp3"]),
    );
    expect(result.get(1)).toBe("Chapter 1");
    expect(result.get(2)).toBe("Chapter 2");
    expect(result.has(3)).toBe(false);
  });

  it("falls back to position only when counts agree exactly", () => {
    const result = matchChaptersToTracks(
      // No fileName on either side, so nothing can match by identity.
      tracks({ file: "a.mp3", title: "Section 01" }, { file: "b.mp3", title: "Section 02" }),
      [
        { title: "The Alchemist" },
        { title: "The Ash Tree" },
      ],
    );
    expect(result.get(1)).toBe("The Alchemist");
    expect(result.get(2)).toBe("The Ash Tree");
  });

  it("does not overwrite a descriptive title during positional fallback", () => {
    const result = matchChaptersToTracks(
      tracks({ file: "a.mp3", title: "Section 01" }, { file: "b.mp3", title: "The Alchemist" }),
      [{ title: "Opening" }, { title: "The Ash Tree" }],
    );
    expect(result.get(1)).toBe("Opening");
    // Track 2 already has a real title, so the weak positional signal is not
    // spent on it.
    expect(result.has(2)).toBe(false);
  });

  it("refuses to guess when the counts are wildly different", () => {
    const result = matchChaptersToTracks(
      tracks({ file: "a.mp3", title: "Section 01" }),
      [{ title: "One" }, { title: "Two" }, { title: "Three" }],
    );
    expect(result.size).toBe(0);
  });

  it("returns nothing for empty inputs", () => {
    expect(matchChaptersToTracks([], chapters(["a.mp3"])).size).toBe(0);
    expect(matchChaptersToTracks(tracks({ file: "a.mp3" }), []).size).toBe(0);
  });

  it("matches filenames case- and separator-insensitively", () => {
    const result = matchChaptersToTracks(
      tracks({ file: "Chapter_One_64kb.mp3", title: "x" }),
      [{ title: "The Real Title", fileName: "Chapter_One_64kb.mp3" }],
    );
    expect(result.get(1)).toBe("The Real Title");
  });
});

describe("track title overrides", () => {
  it("namespaces the override field by track number", () => {
    expect(trackTitleOverrideField(3)).toBe("trackTitle:3");
  });

  it("picks only track titles out of a book's override rows", () => {
    const overrides = parseTrackTitleOverrides([
      { field: "title", value: "Creepy Tales" },
      { field: "narrator", value: "Kara Shallenberg" },
      { field: trackTitleOverrideField(2), value: "The Tell-Tale Heart" },
    ]);
    expect(overrides.size).toBe(1);
    expect(overrides.get(2)).toBe("The Tell-Tale Heart");
  });

  it("ignores an empty override rather than blanking the chapter", () => {
    // An empty value would block the scanner and the provider from ever
    // filling the chapter in, which is the opposite of what clearing means.
    expect(parseTrackTitleOverrides([{ field: "trackTitle:1", value: "   " }]).size).toBe(0);
  });

  it("ignores rows that are not well-formed", () => {
    expect(parseTrackTitleOverrides([{ field: "trackTitle:", value: "x" }]).size).toBe(0);
    expect(parseTrackTitleOverrides([{ field: "trackTitle:abc", value: "x" }]).size).toBe(0);
    expect(parseTrackTitleOverrides([{ field: "notATrackTitle:1", value: "x" }]).size).toBe(0);
  });

  it("lets the user title win over the embedded tag", () => {
    const overrides = parseTrackTitleOverrides([{ field: trackTitleOverrideField(1), value: "My Name" }]);
    expect(resolveTrackTitle(1, "Section 01", overrides)).toBe("My Name");
  });

  it("falls back to the embedded tag for tracks with no override", () => {
    const overrides = parseTrackTitleOverrides([{ field: trackTitleOverrideField(1), value: "My Name" }]);
    expect(resolveTrackTitle(2, "Section 02", overrides)).toBe("Section 02");
  });
});

describe("mapLibrivoxSections", () => {
  it("reads the audio filename out of listen_url", () => {
    const result = mapLibrivoxSections([
      {
        title: "Chapters I-V",
        playtime: 2173,
        listen_url: "https://www.archive.org/download/awakening_librivox/awakening_01_chopin_64kb.mp3",
        file_name: null,
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Chapters I-V");
    // file_name is null in the real API, so listen_url is the real signal.
    expect(result[0].fileName).toBe("awakening_01_chopin_64kb.mp3");
    expect(result[0].lengthSec).toBe(2173);
  });

  it("prefers file_name when the API does provide it", () => {
    const result = mapLibrivoxSections([
      { title: "One", file_name: "explicit.mp3", listen_url: "https://x/other.mp3" },
    ]);
    expect(result[0].fileName).toBe("explicit.mp3");
  });

  it("trims provider whitespace", () => {
    const result = mapLibrivoxSections([{ title: "  Barbox Brothers  " }]);
    expect(result[0].title).toBe("Barbox Brothers");
  });

  it("skips sections with no title", () => {
    expect(mapLibrivoxSections([{ title: "" }, { title: "   " }])).toHaveLength(0);
  });

  it("tolerates no sections at all", () => {
    expect(mapLibrivoxSections(undefined)).toEqual([]);
  });
});

describe("extractAsin", () => {
  it("finds an ASIN in a filename", () => {
    expect(extractAsin("/books/Project Hail Mary B08G9PRS1K.m4b")).toBe("B08G9PRS1K");
  });

  it("finds an ASIN in a bare string", () => {
    expect(extractAsin("B002XLHS8Q")).toBe("B002XLHS8Q");
  });

  it("returns nothing when there is no ASIN", () => {
    expect(extractAsin("/books/dune.m4b")).toBeUndefined();
    expect(extractAsin("")).toBeUndefined();
    expect(extractAsin(null)).toBeUndefined();
  });

  it("requires the canonical uppercase form, avoiding false positives", () => {
    expect(extractAsin("b08g9prs1k")).toBeUndefined();
  });

  it("requires exactly 10 characters", () => {
    expect(extractAsin("B08G9PRS1")).toBeUndefined();
    expect(extractAsin("B08G9PRS1KX")).toBeUndefined();
  });
});