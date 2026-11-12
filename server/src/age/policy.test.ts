import { describe, expect, it } from "vitest";
import { canProfileSeeBook } from "./policy";

const BLOCKED = new Set<number>([7, 42]);

const child = (ageBand: string | null, role = "child") => ({ role, ageBand });
const book = (minimumAge: number | null, genreIds: number[] = []) => ({ minimumAge, genreIds });

describe("canProfileSeeBook (spec 38)", () => {
  it("lets non-child roles see everything, whatever the rating", () => {
    for (const role of ["admin", "member"]) {
      expect(canProfileSeeBook(child("under-6", role), book(16, [7, 42]), BLOCKED)).toBe(true);
      expect(canProfileSeeBook(child(null, role), book(null, []), BLOCKED)).toBe(true);
    }
  });

  it("shows an unrated book to a child", () => {
    expect(canProfileSeeBook(child("under-6"), book(null), BLOCKED)).toBe(true);
  });

  it("shows a book whose minimumAge is at or below the child's ceiling", () => {
    expect(canProfileSeeBook(child("under-6"), book(0), BLOCKED)).toBe(true);
    expect(canProfileSeeBook(child("under-6"), book(5), BLOCKED)).toBe(true);
    expect(canProfileSeeBook(child("6-9"), book(5), BLOCKED)).toBe(true);
    expect(canProfileSeeBook(child("6-9"), book(9), BLOCKED)).toBe(true);
    expect(canProfileSeeBook(child("10-13"), book(13), BLOCKED)).toBe(true);
    expect(canProfileSeeBook(child("14-17"), book(16), BLOCKED)).toBe(true);
  });

  it("hides a book whose minimumAge is above the child's ceiling", () => {
    expect(canProfileSeeBook(child("under-6"), book(7), BLOCKED)).toBe(false);
    expect(canProfileSeeBook(child("6-9"), book(12), BLOCKED)).toBe(false);
    expect(canProfileSeeBook(child("10-13"), book(16), BLOCKED)).toBe(false);
    // 14-17 has ceiling 17, so only a hypothetical >17 rating hides.
    expect(canProfileSeeBook(child("14-17"), book(16), BLOCKED)).toBe(true);
  });

  it("the genre blocklist hides a book from EVERY child band, even unrated and even within ceiling", () => {
    for (const band of ["under-6", "6-9", "10-13", "14-17"]) {
      expect(canProfileSeeBook(child(band), book(null, [7]), BLOCKED)).toBe(false);
      expect(canProfileSeeBook(child(band), book(null, [1, 42]), BLOCKED)).toBe(false);
      expect(canProfileSeeBook(child(band), book(0, [7]), BLOCKED)).toBe(false);
    }
  });

  it("the blocklist beats a confirmed rating below the ceiling and does not affect non-children", () => {
    expect(canProfileSeeBook({ role: "member", ageBand: null }, book(16, [7]), BLOCKED)).toBe(true);
    expect(canProfileSeeBook({ role: "admin", ageBand: null }, book(16, [42]), BLOCKED)).toBe(true);
  });

  it("fails closed for an unrecognised band (strictest ceiling)", () => {
    expect(canProfileSeeBook(child("adult"), book(7), BLOCKED)).toBe(false);
    expect(canProfileSeeBook(child(null), book(7), BLOCKED)).toBe(false);
    expect(canProfileSeeBook(child(null), book(5), BLOCKED)).toBe(true);
  });

  it("empty blocklist changes nothing", () => {
    expect(canProfileSeeBook(child("under-6"), book(5, [7]), new Set())).toBe(true);
    expect(canProfileSeeBook(child("under-6"), book(7, [7]), new Set())).toBe(false);
  });
});
