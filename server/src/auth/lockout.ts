import type { Profile } from "@prisma/client";
import { AuthFailure } from "./service-types";

export interface RateLimiterOptions {
  windowMs?: number;
  maxFailures?: number;
  now?: () => Date;
  failureErrorCode?: "account_locked" | "oauth_rate_limited";
}

export class SlidingRateLimiter {
  private readonly failures = new Map<string, { count: number; resetAt: number }>();
  private readonly windowMs: number;
  private readonly maxFailures: number;
  private readonly now: () => Date;
  private readonly failureErrorCode: "account_locked" | "oauth_rate_limited";

  constructor(options: RateLimiterOptions = {}) {
    this.windowMs = options.windowMs ?? 10 * 60 * 1000;
    this.maxFailures = options.maxFailures ?? 20;
    this.now = options.now ?? (() => new Date());
    this.failureErrorCode = options.failureErrorCode ?? "account_locked";
  }

  check(key: string): void {
    const entry = this.failures.get(key);
    if (!entry) return;
    const now = this.now().getTime();
    if (now >= entry.resetAt) {
      this.failures.delete(key);
      return;
    }
    if (entry.count >= this.maxFailures) {
      throw new AuthFailure(429, this.failureErrorCode, {
        retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000),
      });
    }
  }

  record(key: string): void {
    const now = this.now().getTime();
    const entry = this.failures.get(key);
    if (!entry || now >= entry.resetAt) {
      this.failures.set(key, { count: 1, resetAt: now + this.windowMs });
      return;
    }
    entry.count += 1;
  }

  clear(key: string): void {
    this.failures.delete(key);
  }
}

const LOCK_AFTER = 5;

export class AccountLockout {
  private readonly now: () => Date;

  constructor(now?: () => Date) {
    this.now = now ?? (() => new Date());
  }

  lockedSeconds(profile: Profile): number {
    if (!profile.lockedUntil) return 0;
    // Deliberately not `secondsUntil`: that clamps to at least 1 for the
    // retry-after header, which would make an expired lock look permanent.
    const remaining = profile.lockedUntil.getTime() - this.now().getTime();
    return Math.max(0, Math.ceil(remaining / 1000));
  }

  secondsUntil(date: Date): number {
    return Math.max(1, Math.ceil((date.getTime() - this.now().getTime()) / 1000));
  }

  computeLockout(currentFailures: number): { nextFailures: number; lockedUntil: Date | null } {
    const nextFailures = currentFailures + 1;
    let lockedUntil: Date | null = null;
    if (nextFailures >= LOCK_AFTER) {
      const exponent = Math.min(nextFailures - LOCK_AFTER, 5);
      const seconds = Math.min(30 * 2 ** exponent, 900);
      lockedUntil = new Date(this.now().getTime() + seconds * 1000);
    }
    return { nextFailures, lockedUntil };
  }
}
