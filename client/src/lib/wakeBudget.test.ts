import { describe, it, expect } from "vitest";
import { FAST_PROBE_MS, WAKE_TIMEOUT_MS, WAKE_BACKOFF_MS } from "./wakeBudget";

/**
 * Spec 42, phase 1 — the wake budget, one home.
 *
 * The budget used to be written three times in three against-the-grain shapes
 * (`PROBE_TIMEOUT_MS` in reachability, `WAKE_TIMEOUT_MS` in useSession, the
 * stream ladder in ChapterPlayer) with nothing pinning them to each other.
 * These tests are the contract: the shapes stay numeric, and the ladder
 * outlasts the wake probe.
 */

describe("wakeBudget", () => {
  it("keeps the fast probe short enough that nobody waits for it", () => {
    expect(FAST_PROBE_MS).toBe(10_000);
    expect(FAST_PROBE_MS).toBeLessThanOrEqual(15_000);
  });

  it("gives a cold instance the better part of a minute to answer", () => {
    expect(WAKE_TIMEOUT_MS).toBe(75_000);
  });

  it("keeps the fast probe faster than the patient one", () => {
    expect(FAST_PROBE_MS).toBeLessThan(WAKE_TIMEOUT_MS);
  });

  it("pins the stream-retry ladder, and keeps it able to outlast the wake probe", () => {
    expect(WAKE_BACKOFF_MS).toEqual([1_000, 3_000, 8_000, 20_000, 45_000]);
    // Landing on the last peak means the instance came up: the ladder's total
    // spend must be at least the patient probe's budget.
    const total = WAKE_BACKOFF_MS.reduce((sum, step) => sum + step, 0);
    expect(total).toBeGreaterThanOrEqual(WAKE_TIMEOUT_MS);
  });
});
