import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { fail } from "../http-errors";
import { publicMediaItem } from "../book-payload";
import type { EnrichmentManager } from "../metadata/run";
import { isDemoMode } from "../auth/demo-policy";
import { canTriggerMemberEnrich } from "../metadata/eligibility";

export interface EnrichmentRouteDeps {
  prisma: PrismaClient;
  accountExperience: "household" | "demo";
  enrichment: EnrichmentManager;
  parseIdParam: (raw: string | undefined) => number | null;
  canReadMediaItem: (request: FastifyRequest, mediaItemId: number) => Promise<boolean>;
}

export async function registerEnrichmentRoutes(
  app: FastifyInstance,
  deps: EnrichmentRouteDeps,
): Promise<void> {
  const { prisma, accountExperience, enrichment, parseIdParam, canReadMediaItem } = deps;

  // ---------------------------------------------------------------------
  // Spec 16 — metadata enrichment
  // ---------------------------------------------------------------------

  /**
   * Manual single-book lookup. Runs the same machinery as a background pass —
   * writes the run row and honours FieldOverrides (ADR 009) — rather than a
   * bypass that leaves the book in a state the next pass would re-apply over.
   */
  app.post<{ Params: { id: string } }>("/api/audiobooks/:id/enrich", {
    schema: {
      params: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
    },
  }, async (request, reply) => {
    if (isDemoMode(accountExperience)) return fail(reply, 404, "not_found");
    const id = parseIdParam(request.params.id);
    if (id === null) return fail(reply, 400, "invalid_id");
    const item = await prisma.mediaItem.findUnique({ where: { id }, select: { id: true, enrichmentStatus: true } });
    if (!item) return fail(reply, 404, "audiobook_not_found");
    const role = request.auth?.role ?? null;
    if (!canTriggerMemberEnrich(role, item.enrichmentStatus)) {
      return fail(reply, 403, "forbidden");
    }
    if (!(await canReadMediaItem(request, id))) return fail(reply, 403, "forbidden");
    const candidates = await enrichment.enrichOneNow(id);
    if (candidates === null) return fail(reply, 404, "audiobook_not_found");
    return candidates;
  });

  app.post("/api/enrichment/run", {
    schema: {
      body: {
        type: "object",
        properties: {
          mediaItemId: { type: "integer", minimum: 1 },
          force: { type: "boolean", default: false },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    if (isDemoMode(accountExperience)) return fail(reply, 404, "not_found");
    const body = (request.body ?? {}) as { mediaItemId?: number; force?: boolean };
    return enrichment.enqueue({ mediaItemId: body.mediaItemId, force: body.force });
  });

  app.get("/api/enrichment/status", async (_request, reply) =>
    isDemoMode(accountExperience) ? fail(reply, 404, "not_found") : enrichment.status());

  /** The spec 16 review queue: everything below the auto-apply threshold. */
  app.get("/api/enrichment/review-queue", async (request, reply) => {
    if (isDemoMode(accountExperience)) return fail(reply, 404, "not_found");
    // Spec 38: the queue is household-wide catalogue curation — children get no peek.
    if (request.auth?.role === "child") return fail(reply, 403, "forbidden");
    const items = await prisma.mediaItem.findMany({
      where: { enrichmentStatus: "review" },
      orderBy: { updatedAt: "desc" },
    });
    return items.map(publicMediaItem);
  });
}

