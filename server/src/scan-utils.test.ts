import { describe, it, expect } from "vitest";
import { groupFiles, audiobookTitle, titleFromFilename, isAudioFile } from "./scan-utils";

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

  it("uses the directory name for multi-file groups", () => {
    const group = [
      { filePath: "/lib/Book A/01.mp3", title: "Ch 1" },
      { filePath: "/lib/Book A/02.mp3", title: "Ch 2" },
    ];
    expect(audiobookTitle(group)).toBe("Book A");
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
