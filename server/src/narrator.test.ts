import { describe, it, expect } from "vitest";
import {
  looksLikePersonName,
  narratorFromComment,
  narratorFromFolder,
  resolveLocalNarrator,
  splitNarrators,
} from "./narrator";

/**
 * Spec 24 — narrator resolution.
 *
 * The negative cases matter more than the positive ones here: the folder
 * heuristic is the weakest source and a false positive is worse than a miss,
 * because a book silently credited to "Unabridged" is a lie the UI will show.
 *
 * The positive cases are real strings taken from the fixture library added on
 * 2026-10-13, and the negative cases are the folders that must NOT match.
 */

describe("looksLikePersonName", () => {
  it("accepts real names", () => {
    expect(looksLikePersonName("Stephen Fry")).toBe(true);
    expect(looksLikePersonName("Simon Vance")).toBe(true);
    expect(looksLikePersonName("J. K. Rowling")).toBe(true);
    expect(looksLikePersonName("Kara Shallenberg")).toBe(true);
  });

  it("rejects non-people that appear in bracketed folder names", () => {
    for (const value of ["Unabridged", "Retail Rip", "Audiobook", "Full Cast", "MP3", "M4B", "Rip"]) {
      expect(looksLikePersonName(value), value).toBe(false);
    }
  });

  it("rejects anything with digits or path separators", () => {
    expect(looksLikePersonName("Vol 2 Stephen Fry")).toBe(false);
    expect(looksLikePersonName("Fry/More")).toBe(false);
  });

  it("rejects a single token", () => {
    // Two tokens is what separates a person from "Unabridged".
    expect(looksLikePersonName("Cher")).toBe(false);
  });

  it("rejects empty and oversized input", () => {
    expect(looksLikePersonName("")).toBe(false);
    expect(looksLikePersonName(null)).toBe(false);
    expect(looksLikePersonName(undefined)).toBe(false);
    expect(looksLikePersonName("A" + "b".repeat(80))).toBe(false);
  });
});

describe("splitNarrators", () => {
  it("splits on commas and conjunctions", () => {
    expect(splitNarrators("Scott Brick and David Most")).toEqual(["Scott Brick", "David Most"]);
    expect(splitNarrators("Simon Vance, Kate Reading")).toEqual(["Simon Vance", "Kate Reading"]);
    expect(splitNarrators("A B & C D")).toEqual(["A B", "C D"]);
  });

  it("leaves a single name alone", () => {
    expect(splitNarrators("Stephen Fry")).toEqual(["Stephen Fry"]);
  });
});

describe("narratorFromComment", () => {
  it("reads the real tag value from the fixture library", () => {
    // Verbatim from Deathly Hallows / Order of the Phoenix mp3s.
    expect(narratorFromComment("Read By Stephen Fry")).toEqual(["Stephen Fry"]);
    expect(narratorFromComment("Read by Stephen Fry")).toEqual(["Stephen Fry"]);
  });

  it("handles the narrated-by and labelled forms", () => {
    expect(narratorFromComment("Narrated by Simon Vance")).toEqual(["Simon Vance"]);
    expect(narratorFromComment("Narrator: Kate Reading")).toEqual(["Kate Reading"]);
    expect(narratorFromComment("Read by - Stephen Fry")).toEqual(["Stephen Fry"]);
  });

  it("handles a full cast in one tag", () => {
    expect(narratorFromComment("Read by Scott Brick and David Most")).toEqual([
      "Scott Brick",
      "David Most",
    ]);
  });

  it("ignores comments that are not about the narrator", () => {
    expect(narratorFromComment("Unabridged")).toEqual([]);
    expect(narratorFromComment("")).toEqual([]);
    expect(narratorFromComment(null)).toEqual([]);
  });

  it("rejects a comment whose value is not a person", () => {
    expect(narratorFromComment("Read by Unabridged")).toEqual([]);
  });
});

describe("narratorFromFolder", () => {
  it("reads a plain bracketed name", () => {
    // Real folder names from the fixture library.
    expect(narratorFromFolder("Vol 7 - 2007 - Harry Potter {Stephen Fry}")).toEqual(["Stephen Fry"]);
  });

  it("strips a narrated-by prefix inside the brackets", () => {
    expect(narratorFromFolder("Harry Potter (Narrated by Stephen Fry)")).toEqual(["Stephen Fry"]);
  });

  it("ignores unbracketed folder names entirely", () => {
    expect(narratorFromFolder("Book 06 - Harry Potter and the Half-Blood Prince")).toEqual([]);
  });

  it("rejects a bracketed word that is not a person", () => {
    expect(narratorFromFolder("Some Audiobook {Unabridged}")).toEqual([]);
    expect(narratorFromFolder("Some Audiobook [Retail Rip]")).toEqual([]);
    expect(narratorFromFolder("Book {MP3}")).toEqual([]);
  });

  it("handles empty and missing input", () => {
    expect(narratorFromFolder("")).toEqual([]);
    expect(narratorFromFolder(null)).toEqual([]);
    expect(narratorFromFolder(undefined)).toEqual([]);
  });
});

describe("resolveLocalNarrator", () => {
  it("prefers the composer atom above everything else", () => {
    // The Ickabog M4B: composer is authoritative and already worked.
    const result = resolveLocalNarrator({
      composer: "Stephen Fry",
      comment: "Read By Someone Else",
      folderName: "{Another Person}",
    });
    expect(result).toEqual({ names: ["Stephen Fry"], source: "composer" });
  });

  it("falls back to the comment field", () => {
    const result = resolveLocalNarrator({
      comment: "Read By Stephen Fry",
      folderName: "{Someone Else}",
    });
    expect(result).toEqual({ names: ["Stephen Fry"], source: "comment" });
  });

  it("falls back to the folder name last", () => {
    const result = resolveLocalNarrator({ folderName: "Vol 7 {Stephen Fry}" });
    expect(result).toEqual({ names: ["Stephen Fry"], source: "folder" });
  });

  it("returns null rather than guessing", () => {
    expect(resolveLocalNarrator({})).toBeNull();
    expect(resolveLocalNarrator({ comment: "Unabridged", folderName: "Plain Name" })).toBeNull();
  });

  it("resolves every commercial book in the fixture library", () => {
    // The exact inputs observed on 2026-10-13. This is the regression that
    // motivated the spec: narrator coverage was 3/12 before it.
    const fixtures = [
      { folder: "The Ickabog by J. K. Rowling M4B", composer: "Stephen Fry", expect: "Stephen Fry" },
      {
        folder: "Vol 7 - 2007 - Harry Potter and the Deathly Hallows {Stephen Fry}",
        comment: "Read By Stephen Fry",
        expect: "Stephen Fry",
      },
      {
        folder: "Harry Potter and the Order of the Phoenix (2003) (Narrated by Stephen Fry)",
        comment: "Read by Stephen Fry",
        expect: "Stephen Fry",
      },
      { folder: "Vol 4 - 2000 - Harry Potter and the Goblet of Fire {Stephen Fry}", expect: "Stephen Fry" },
      { folder: "Book 06 - Harry Potter and the Half-Blood Prince", expect: null },
      { folder: "Harry Pooter Philanthropists Bone", expect: null },
    ];
    for (const f of fixtures) {
      const got = resolveLocalNarrator({
        composer: f.composer,
        comment: f.comment,
        folderName: f.folder,
      });
      const name = got?.names[0] ?? null;
      expect(name, f.folder).toBe(f.expect);
    }
  });
});