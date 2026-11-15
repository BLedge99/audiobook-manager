/**
 * GET /api/buy-context — the one server call the "Get this book" sheet makes.
 *
 * Query params are validated by Fastify; the upstream call is limited,
 * cached and deadline-bound inside `metadata/buy-context.ts`. There is no
 * database access, no personal-data handling and no logging of values.
 *
 * Rate limit: 30 requests per profile per minute, in memory — the sheet
 * issues one call per open, so a human never approaches this; it exists
 * only to keep a stuck retry loop off LibriVox.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { fail } from "../http-errors";
import type { AccountExperience } from "../auth/demo-policy";
import { findLibrivoxMatch } from "../metadata/buy-context";
import { RateLimiter } from "../rate-limit";

export interface BuyContextRouteDeps {
  accountExperience: AccountExperience;
  requireProfileId: (request: FastifyRequest) => number | null;
}

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 30;
// One bounded, self-sweeping table (see server/src/rate-limit.ts): entries
// expire with the window, and a full table drops the oldest instead of
// growing for the life of the process.
const limiter = new RateLimiter(RATE_WINDOW_MS);

/** Test seam: empty the per-profile rate buckets. */
export function clearBuyContextRateCounters(): void {
  limiter.clearAll();
}

export async function registerBuyContextRoutes(
  app: FastifyInstance,
  deps: BuyContextRouteDeps,
): Promise<void> {
  app.get<{ Querystring: { title: string; author?: string } }>("/api/buy-context", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          title: { type: "string", minLength: 1, maxLength: 200 },
          author: { type: "string", maxLength: 200 },
        },
        required: ["title"],
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const profileId = deps.requireProfileId(request);
    if (profileId === null) return fail(reply, 400, "profile_required");

    const now = Date.now();
    const key = String(profileId);
    const decision = limiter.allow(key, RATE_LIMIT, now);
    if (!decision.allowed) return fail(reply, 429, "rate_limited");
    limiter.record(key, now);

    const { title, author } = request.query;
    const match = await findLibrivoxMatch({ title: title.trim(), author: author?.trim() || undefined });
    return { librivox: match };
  });
}
