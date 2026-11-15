import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  AGE_BANDS,
  MAX_AGE_BY_BAND,
  STRICTEST_MAX_AGE,
  isAgeBand,
  maxAgeForBand,
} from "./bands";

/**
 * The client re-implements this ladder (it cannot import server code) and its
 * fail-closed default decides what an offline kid sees. Both tiers assert
 * against one checked-in fixture so the two can never drift apart silently.
 */
const fixture = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../../test/fixtures/age-ladder.json"), "utf8"),
) as { bands: string[]; maxAgeByBand: Record<string, number>; strictestMaxAge: number };

describe("bands (spec 38)", () => {
  it("knows exactly the four bands, in order", () => {
    expect([...AGE_BANDS]).toEqual(["under-6", "6-9", "10-13", "14-17"]);
  });

  it("maps each band to its max age", () => {
    expect(MAX_AGE_BY_BAND["under-6"]).toBe(5);
    expect(MAX_AGE_BY_BAND["6-9"]).toBe(9);
    expect(MAX_AGE_BY_BAND["10-13"]).toBe(13);
    expect(MAX_AGE_BY_BAND["14-17"]).toBe(17);
  });

  it("isAgeBand accepts the four and nothing else", () => {
    expect(isAgeBand("under-6")).toBe(true);
    expect(isAgeBand("6-9")).toBe(true);
    expect(isAgeBand("10-13")).toBe(true);
    expect(isAgeBand("14-17")).toBe(true);
    for (const bad of ["5", "6", "UNDER-6", "", "under_6", null, undefined, 5, {}]) {
      expect(isAgeBand(bad)).toBe(false);
    }
  });

  it("maxAgeForBand returns the band's ceiling", () => {
    expect(maxAgeForBand("under-6")).toBe(5);
    expect(maxAgeForBand("6-9")).toBe(9);
    expect(maxAgeForBand("10-13")).toBe(13);
    expect(maxAgeForBand("14-17")).toBe(17);
  });

  it("fails closed: an unrecognised band gets the strictest ceiling", () => {
    for (const bad of ["adult", "", "12+", null, undefined, 9, NaN]) {
      expect(maxAgeForBand(bad)).toBe(STRICTEST_MAX_AGE);
    }
  });
});

describe("the age ladder matches the shared fixture (spec 41 phase 3)", () => {
  it("the band list matches the fixture", () => {
    expect([...AGE_BANDS]).toEqual(fixture.bands);
  });

  it("every band ceiling matches the fixture", () => {
    for (const band of fixture.bands) {
      expect(MAX_AGE_BY_BAND[band as keyof typeof MAX_AGE_BY_BAND]).toBe(
        fixture.maxAgeByBand[band],
      );
    }
  });

  it("the fail-closed ceiling matches the fixture", () => {
    expect(STRICTEST_MAX_AGE).toBe(fixture.strictestMaxAge);
    expect(maxAgeForBand("bogus")).toBe(fixture.strictestMaxAge);
  });
});
