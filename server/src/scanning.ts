/**
 * The scan-trigger-plus-enqueue rule, owned once (spec 37, step 7.8).
 *
 * Starting a scan and kicking off enrichment when it finishes is the same
 * operation on both listeners. The listeners differ only in their auth
 * boundary; this module is the shared implementation.
 */
import type { PrismaClient } from "@prisma/client";
import type { ScanManager } from "./scanner";
import type { EnrichmentManager } from "./metadata/run";

export interface ScanDeps {
  prisma: PrismaClient;
  scanner: ScanManager;
  enrichment: Pick<EnrichmentManager, "enqueue">;
  logger: {
    info: (obj: unknown, msg?: string) => void;
    error: (obj: unknown, msg?: string) => void;
  };
}

export type StartScanResult =
  | { started: true; rootIds: number[] }
  | { started: false; reason: "no-roots" };

/**
 * Fire off scans (not awaited) and enqueue enrichment as each completes.
 * Returns synchronously once the work is kicked off.
 */
export async function startScanWithEnrichment(
  deps: ScanDeps,
  options: { rootId?: number },
): Promise<StartScanResult> {
  const { prisma, scanner, enrichment, logger } = deps;
  const roots = options.rootId !== undefined
    ? await prisma.libraryRoot.findMany({ where: { id: options.rootId } })
    : await prisma.libraryRoot.findMany();
  if (roots.length === 0) return { started: false, reason: "no-roots" };

  for (const root of roots) {
    void scanner
      .scanRoot(root.id)
      .then(async () => {
        // Spec 16: completing a scan automatically kicks off a background
        // enrichment pass. Failures here must never affect the scan result.
        try {
          const status = await enrichment.enqueue();
          logger.info({ enrichment: status }, "scan finished, enrichment enqueued");
        } catch (error) {
          logger.error({ error }, "failed to enqueue enrichment after scan");
        }
      })
      .catch((error) => logger.error({ error }, "scan failed"));
  }

  return { started: true, rootIds: roots.map((root) => root.id) };
}
