import { describe, it, expect } from "vitest";
import { isDemoExperience } from "./experience";

/**
 * Spec 42, phase 10 — one answer to "is this the demo?".
 *
 * The kids question got one home (`local/kids.ts`) with a predicate and a
 * sweep; the demo question is the same shape and got the same treatment —
 * or it drifts back to sixteen hand-rolled comparisons.
 *
 * Fail-closed means the restricted surface (household): an unknown experience
 * is NOT the demo.
 */

describe("isDemoExperience", () => {
  it("is the demo only for the demo", () => {
    expect(isDemoExperience("demo")).toBe(true);
    expect(isDemoExperience("household")).toBe(false);
  });

  it("treats an unknown or missing experience as the household, never the demo", () => {
    expect(isDemoExperience(undefined)).toBe(false);
    expect(isDemoExperience(null)).toBe(false);
    expect(isDemoExperience("")).toBe(false);
  });
});
