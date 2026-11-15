import { describe, expect, it } from "vitest";
import { isKidsAccount, canSeeBuySurfaces } from "./kids";

describe("isKidsAccount (spec 41 phase 4)", () => {
  it("is true for the child role only", () => {
    expect(isKidsAccount("child")).toBe(true);
    for (const role of ["admin", "member", undefined, null, "", "Child", "KID"]) {
      expect(isKidsAccount(role)).toBe(false);
    }
  });
});

describe("canSeeBuySurfaces (spec 41 phase 4)", () => {
  it("fails closed for children and fails open for everyone else", () => {
    expect(canSeeBuySurfaces("child")).toBe(false);
    for (const role of ["admin", "member", undefined, null, ""]) {
      expect(canSeeBuySurfaces(role)).toBe(true);
    }
  });
});
