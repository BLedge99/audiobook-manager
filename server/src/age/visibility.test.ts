import { describe, expect, it } from "vitest";
import { visibilityWhere, andVisibility } from "./visibility";

const child9 = { role: "child", ageBand: "6-9" };

describe("visibilityWhere (spec 38)", () => {
  it("returns null for non-children (no added constraint)", () => {
    expect(visibilityWhere({ role: "member", ageBand: null }, new Set([1]))).toBeNull();
    expect(visibilityWhere({ role: "admin", ageBand: null }, new Set([1, 2]))).toBeNull();
  });

  it("constrains minimumAge to null OR <= the band ceiling", () => {
    const where = visibilityWhere(child9, new Set()) as any;
    expect(where).toEqual({
      AND: [{ OR: [{ minimumAge: null }, { minimumAge: { lte: 9 } }] }],
    });
  });

  it("adds a genre-blocklist NOT clause when the blocklist is non-empty", () => {
    const where = visibilityWhere(child9, new Set([7, 42])) as any;
    expect(where.AND).toContainEqual({ NOT: { genres: { some: { genreId: { in: [7, 42] } } } } });
  });

  it("omits the blocklist clause when the blocklist is empty", () => {
    const where = visibilityWhere(child9, new Set()) as any;
    expect(where.AND).toHaveLength(1);
  });

  it("andVisibility composes with an existing where", () => {
    const base = { title: { contains: "x" } };
    expect(andVisibility(base, null)).toBe(base);
    const combined = andVisibility(base, visibilityWhere(child9, new Set())) as any;
    expect(combined.AND).toContainEqual(base);
    expect(combined.AND).toHaveLength(2);
  });

  it("fails closed for a child with an unrecognised band", () => {
    const where = visibilityWhere({ role: "child", ageBand: "ancient" }, new Set()) as any;
    expect(where.AND[0].OR[1]).toEqual({ minimumAge: { lte: 5 } });
  });
});
