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

export interface BuyContextRouteDeps {
  accountExperience: AccountExperience;
  requireProfileId: (request: FastifyRequest) => number | null;
}

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 30;
const counters = new Map<number, { count: number; resetAt: number }>();

/** Test seam. */
export function clearBuyContextRateCounters(): void {
  counters.clear();
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
    const slot = counters.get(profileId);
    if (slot && now < slot.resetAt) {
      if (slot.count >= RATE_LIMIT) return fail(reply, 429, "rate_limited");
      slot.count += 1;
    } else {
      counters.set(profileId, { count: 1, resetAt: now + RATE_WINDOW_MS });
    }

    const { title, author } = request.query;
    const match = await findLibrivoxMatch({ title: title.trim(), author: author?.trim() || undefined });
    return { librivox: match };
  });
}
