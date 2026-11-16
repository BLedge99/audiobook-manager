import type { FastifyServerOptions } from "fastify";

/**
 * Parsing for the TRUST_PROXY environment variable.
 *
 * The naive `value === "true" ? true : list` form trusts *every* proxy on the
 * internet — any client can then spoof X-Forwarded-For and walk past the
 * per-IP rate limiter. A hop count is the right shape for "there is exactly
 * one proxy in front of me"; Fastify models hop counts as a predicate.
 *
 *   unset            → false (no proxy; socket address is the client)
 *   "true"           → 1 hop predicate  (the common single-edge deploy)
 *   "2" (digits)     → 2 hops predicate (e.g. CDN → LB → app)
 *   "10.0.0.1, ::1"  → ["10.0.0.1", "::1"] (explicit proxy addresses)
 */
export type TrustProxySetting = NonNullable<FastifyServerOptions["trustProxy"]>;

export function parseTrustProxy(raw: string | undefined): TrustProxySetting {
  const value = raw?.trim();
  if (!value) return false;
  if (value.toLowerCase() === "true") return hopsPredicate(1);
  if (/^\d+$/.test(value)) return hopsPredicate(Number(value));
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function hopsPredicate(hops: number): (address: string, hop: number) => boolean {
  return (_address: string, hop: number) => hop < hops;
}
