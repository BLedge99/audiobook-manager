import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { offlineMaxAge, bookVisibleOffline, filterDeviceBooks, AGE_BANDS, AGE_BAND_MAX, STRICTEST_MAX_AGE } from "./ageFilter";
import type { Audiobook } from "../types";

/**
 * The server re-implements this ladder (spec 38) and fails closed to the same
 * ceiling. Both tiers assert against one checked-in fixture so the two can
 * never drift apart silently -- a client re-band would otherwise fail open
 * offline while the online gate stayed correct.
 */
const fixture = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../../test/fixtures/age-ladder.json"), "utf8"),
) as { bands: string[]; maxAgeByBand: Record<string, number>; strictestMaxAge: number };

const book = (id: number, minimumAge?: number | null) =>
  ({ id, title: `Book ${id}`, author: "Author", duration: 600, fileFormat: "mp3", minimumAge }) as Audiobook;

describe("offlineMaxAge (spec 38)", () => {
  it("maps the four bands and fails closed otherwise", () => {
    expect(offlineMaxAge("under-6")).toBe(5);
    expect(offlineMaxAge("6-9")).toBe(9);
    expect(offlineMaxAge("10-13")).toBe(13);
    expect(offlineMaxAge("14-17")).toBe(17);
    for (const bad of ["adult", "", null, undefined]) {
      expect(offlineMaxAge(bad as string)).toBe(5);
    }
  });
});

describe("bookVisibleOffline (spec 38)", () => {
  it("is visible when unrated or at/under the ceiling", () => {
    expect(bookVisibleOffline({ minimumAge: null }, 5)).toBe(true);
    expect(bookVisibleOffline({ minimumAge: undefined }, 5)).toBe(true); // pre-feature replica rows
    expect(bookVisibleOffline({ minimumAge: 4 }, 5)).toBe(true);
    expect(bookVisibleOffline({ minimumAge: 7 }, 5)).toBe(false);
  });
});

describe("the age ladder matches the shared fixture (spec 41 phase 3)", () => {
  it("the band list matches the fixture", () => {
    expect([...AGE_BANDS]).toEqual(fixture.bands);
  });

  it("every band ceiling matches the fixture", () => {
    for (const band of fixture.bands) {
      expect(AGE_BAND_MAX[band]).toBe(fixture.maxAgeByBand[band]);
    }
  });

  it("the fail-closed ceiling matches the fixture", () => {
    expect(STRICTEST_MAX_AGE).toBe(fixture.strictestMaxAge);
    expect(offlineMaxAge("bogus")).toBe(fixture.strictestMaxAge);
  });
});

describe("filterDeviceBooks (spec 38)", () => {
  const all = [book(1, 4), book(2, 7), book(3, 16), book(4, null), book(5)];

  it("passes everything through for non-children", () => {
    expect(filterDeviceBooks(all, "member", null)).toHaveLength(5);
    expect(filterDeviceBooks(all, "admin", null)).toHaveLength(5);
    expect(filterDeviceBooks(all, undefined, undefined)).toHaveLength(5);
  });

  it("filters for a child with a band, fails closed without one", () => {
    expect(filterDeviceBooks(all, "child", "under-6").map((b) => b.id)).toEqual([1, 4, 5]);
    expect(filterDeviceBooks(all, "child", "6-9").map((b) => b.id)).toEqual([1, 2, 4, 5]);
    expect(filterDeviceBooks(all, "child", "10-13").map((b) => b.id)).toEqual([1, 2, 4, 5]);
    expect(filterDeviceBooks(all, "child", "14-17").map((b) => b.id)).toEqual([1, 2, 3, 4, 5]);
    expect(filterDeviceBooks(all, "child", "adult").map((b) => b.id)).toEqual([1, 4, 5]);
    expect(filterDeviceBooks(all, "child", null).map((b) => b.id)).toEqual([1, 4, 5]);
  });
});
