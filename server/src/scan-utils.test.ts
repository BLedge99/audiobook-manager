import { describe, it, expect } from "vitest";
import {
  groupFiles,
  audiobookTitle,
  titleFromFilename,
  isAudioFile,
  mostCommonAlbum,
  stripAuthorCredit,
} from "./scan-utils";

describe("isAudioFile", () => {
  it("accepts supported audio extensions case-insensitively", () => {
    expect(isAudioFile("book.MP3")).toBe(true);
    expect(isAudioFile("book.m4b")).toBe(true);
    expect(isAudioFile("book.flac")).toBe(true);
    expect(isAudioFile("notes.txt")).toBe(false);
    expect(isAudioFile("cover.jpg")).toBe(false);
  });
});

describe("groupFiles", () => {
  it("groups files by their directory", () => {
    const files = [
      { filePath: "/lib/Book A/01.mp3" },
      { filePath: "/lib/Book A/02.mp3" },
      { filePath: "/lib/Book B/01.m4b" },
    ];
    const groups = groupFiles(files);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveLength(2);
    expect(groups[1]).toHaveLength(1);
  });
});

describe("audiobookTitle", () => {
  it("uses the file title for single-file groups", () => {
    expect(audiobookTitle([{ filePath: "/lib/Book A/book.m4b", title: "My Book" }])).toBe("My Book");
  });

  it("uses the directory name for multi-file groups with no album tag", () => {
    const group = [
      { filePath: "/lib/Book A/01.mp3", title: "Ch 1" },
      { filePath: "/lib/Book A/02.mp3", title: "Ch 2" },
    ];
    expect(audiobookTitle(group)).toBe("Book A");
  });

  it("prefers the album tag over the directory name", () => {
    // The real library case: folder is an archive.org identifier, while the
    // album tag carries the actual book title.
    const group = [
      { filePath: "/lib/12_creepytales_1206_librivox/01.mp3", title: "01 - THE TELL-TALE HEART", album: "Creepy Tales" },
      { filePath: "/lib/12_creepytales_1206_librivox/02.mp3", title: "02 - THE PIT AND THE PENDULUM", album: "Creepy Tales" },
    ];
    expect(audiobookTitle(group)).toBe("Creepy Tales");
  });

  it("strips a redundant trailing author credit from the album tag", () => {
    const group = [
      { filePath: "/lib/12_creepytales_1206_librivox/01.mp3", title: "01 - X", album: "Creepy Tales by Edgar Allen Poe", author: "Edgar Allen Poe" },
      { filePath: "/lib/12_creepytales_1206_librivox/02.mp3", title: "02 - Y", album: "Creepy Tales by Edgar Allen Poe", author: "Edgar Allen Poe" },
    ];
    expect(audiobookTitle(group)).toBe("Creepy Tales");
  });

  it("breaks an album disagreement on first appearance, deterministically", () => {
    // Mis-tagged tracks disagreeing is a real scenario. Picking the first is
    // arbitrary but stable; the important property is that it does not flap
    // between scans.
    const group = [
      { filePath: "/lib/Book A/01.mp3", title: "Ch 1", album: "One Thing" },
      { filePath: "/lib/Book A/02.mp3", title: "Ch 2", album: "Another Thing" },
    ];
    expect(audiobookTitle(group)).toBe("One Thing");
    expect(audiobookTitle([...group].reverse())).toBe("Another Thing");
  });

  it("falls back to the directory name when no track has an album tag", () => {
    const group = [
      { filePath: "/lib/Book A/01.mp3", title: "Ch 1", album: null },
      { filePath: "/lib/Book A/02.mp3", title: "Ch 2", album: undefined },
    ];
    expect(audiobookTitle(group)).toBe("Book A");
  });

  it("handles an empty group", () => {
    expect(audiobookTitle([])).toBe("Unknown title");
  });
});

describe("mostCommonAlbum", () => {
  it("returns the most frequent album", () => {
    expect(mostCommonAlbum(["A", "B", "A"])).toBe("A");
  });

  it("ignores null and blank entries", () => {
    expect(mostCommonAlbum([null, "  ", "Real"])).toBe("Real");
  });

  it("returns null when nothing usable is present", () => {
    expect(mostCommonAlbum([null, undefined, "  "])).toBeNull();
    expect(mostCommonAlbum([])).toBeNull();
  });

  it("breaks a tie on first appearance so it is deterministic", () => {
    expect(mostCommonAlbum(["B", "A"])).toBe("B");
  });

  it("lets a majority album override a stray first track", () => {
    expect(mostCommonAlbum(["Stray", "Right", "Right", "Right"])).toBe("Right");
  });
});

describe("stripAuthorCredit", () => {
  it("removes a trailing 'by <author>' when the author matches", () => {
    expect(stripAuthorCredit("Creepy Tales by Edgar Allen Poe", "Edgar Allen Poe")).toBe("Creepy Tales");
  });

  it("keeps titles that merely contain the word 'by'", () => {
    expect(stripAuthorCredit("Sailing By", "Alan Bennett")).toBe("Sailing By");
  });

  it("keeps a credit that does not match the known author", () => {
    expect(stripAuthorCredit("A Tale by Someone Else", "Frank Herbert")).toBe("A Tale by Someone Else");
  });

  it("refuses to strip an implausibly long credit", () => {
    const long = "Title by " + "word ".repeat(10).trim();
    expect(stripAuthorCredit(long, "word word word")).toBe(long);
  });

  it("returns the input when there is no credit to strip", () => {
    expect(stripAuthorCredit("Absolute Evil", "Julian Hawthorne")).toBe("Absolute Evil");
  });
});

describe("titleFromFilename", () => {
  it("strips extension and leading track numbers", () => {
    expect(titleFromFilename("/lib/Book/03 - The Tell-Tale Heart.mp3")).toBe("The Tell-Tale Heart");
    expect(titleFromFilename("/lib/Book/01_opening.m4b")).toBe("opening");
  });

  it("falls back to the base name when nothing remains", () => {
    expect(titleFromFilename("/lib/04.mp3")).toBe("04");
  });
});
