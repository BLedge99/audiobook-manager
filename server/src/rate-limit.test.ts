import { describe, it, expect } from "vitest";
import { RateLimiter } from "./rate-limit";

describe("RateLimiter", () => {
  it("allows under the ceiling and blocks at it", () => {
    const limiter = new RateLimiter(60_000);
    const now = 1_000;
    for (let i = 0; i < 3; i += 1) limiter.record("ip", now);
    expect(limiter.allow("ip", 3, now).allowed).toBe(false);
    expect(limiter.allow("ip", 2, now).allowed).toBe(false);
    expect(limiter.allow("other", 3, now).allowed).toBe(true);
  });

  it("expires entries with their window", () => {
    const limiter = new RateLimiter(1_000);
    limiter.record("ip", 0);
    expect(limiter.allow("ip", 1, 500).allowed).toBe(false);
    expect(limiter.allow("ip", 1, 1_001).allowed).toBe(true);
  });

  it("sweeps expired buckets when the table fills instead of growing forever", () => {
    const limiter = new RateLimiter(1_000, 100);
    const now = 10_000;
    for (let i = 0; i < 150; i += 1) limiter.record(`stale-${i}`, 0); // all expired by `now`
    expect(limiter.size).toBeLessThanOrEqual(100);
    // The expired buckets were dropped, not carried.
    for (let i = 0; i < 150; i += 1) expect(limiter.allow(`stale-${i}`, 1, now).allowed).toBe(true);
    limiter.record("fresh", now);
    expect(limiter.allow("fresh", 1, now).allowed).toBe(false);
  });

  it("drops oldest entries when nothing has expired but the table is full", () => {
    const limiter = new RateLimiter(1_000_000, 100);
    const now = 5_000;
    for (let i = 0; i < 120; i += 1) limiter.record(`ip-${i}`, now);
    expect(limiter.size).toBeLessThanOrEqual(100);
    // The newest key must still be tracked.
    expect(limiter.allow("ip-119", 1, now).allowed).toBe(false);
  });
});
