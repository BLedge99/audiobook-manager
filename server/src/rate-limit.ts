/**
 * Bounded in-memory rate limiter. Entries expire with their window; a bucket
 * that fills with distinct keys (a scanner spraying unique source IPs) is
 * swept deterministically instead of growing without bound.
 */
export interface RateWindow {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private readonly map = new Map<string, RateWindow>();

  constructor(
    private readonly windowMs: number,
    private readonly maxEntries = 1_000,
  ) {}

  /** true while the key is under `max` failures inside its window. */
  allow(key: string, max: number, now: number): { allowed: boolean; retryAfterSeconds: number } {
    const entry = this.map.get(key);
    if (!entry) return { allowed: true, retryAfterSeconds: 0 };
    if (now >= entry.resetAt) {
      this.map.delete(key);
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (entry.count >= max) {
      return { allowed: false, retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000) };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }

  record(key: string, now: number): void {
    this.sweep(now);
    const entry = this.map.get(key);
    if (!entry || now >= entry.resetAt) {
      this.map.set(key, { count: 1, resetAt: now + this.windowMs });
      return;
    }
    entry.count += 1;
  }

  clear(key: string): void {
    this.map.delete(key);
  }

  /** Current bucket count — test hook. */
  get size(): number {
    return this.map.size;
  }

  private sweep(now: number): void {
    if (this.map.size < this.maxEntries) return;
    for (const [key, entry] of this.map) {
      if (entry.resetAt <= now) this.map.delete(key);
    }
    // Still too large: drop the oldest-inserted entries until bounded.
    while (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.map.delete(oldest.value);
    }
  }
}
