import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { PrismaClient } from "@prisma/client";
import { fail } from "../http-errors";
import type { ScanManager } from "../scanner";
import { EnrichmentManager } from "../metadata/run";

export interface ScanRoutesOptions {
  prisma: PrismaClient;
  scanner: ScanManager;
  enrichment: EnrichmentManager;
  accountExperience: "household" | "demo";
}

/**
 * Library scan routes.
 *
 * Completing a scan automatically kicks off a background enrichment pass
 * (spec 16); failures there must never affect the scan result.
 */
export function registerScanRoutes(app: FastifyInstance, options: ScanRoutesOptions): void {
  const { prisma, scanner, enrichment, accountExperience } = options;

  app.post<{ Body: { rootId?: number } }>("/api/scan", async (request, reply) => {
    if (accountExperience === "demo") return fail(reply, 404, "not_found");
    const roots = request.body?.rootId
      ? await prisma.libraryRoot.findMany({ where: { id: request.body.rootId } })
      : await prisma.libraryRoot.findMany();
    if (roots.length === 0) return fail(reply, 400, "library_root_required");
    for (const root of roots) {
      void scanner
        .scanRoot(root.id)
        .then(async () => {
          // Spec 16: completing a scan automatically kicks off a background
          // enrichment pass. Failures here must never affect the scan result.
          try {
            const status = await enrichment.enqueue();
            app.log.info({ enrichment: status }, "scan finished, enrichment enqueued");
          } catch (error) {
            app.log.error({ error }, "failed to enqueue enrichment after scan");
          }
        })
        .catch((error) => app.log.error(error));
    }
    return reply.code(202).send({ status: "started", rootIds: roots.map((root) => root.id) });
  });

  app.get("/api/scan/status", async (_request, reply) => {
    if (accountExperience === "demo") return fail(reply, 404, "not_found");
    const roots = await prisma.libraryRoot.findMany({ include: { scanState: true }, orderBy: { id: "asc" } });
    return roots.map((root) => ({
      rootId: root.id,
      path: root.path,
      status: scanner.getProgress(root.id) || root.scanState || { status: "idle", filesFound: 0 },
    }));
  });
}
