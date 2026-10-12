import type { PrismaClient } from "@prisma/client";
import { applyCandidate, storeCandidates } from "./apply";
import { DEFAULT_CONFIDENCE_THRESHOLD, runChain, UNKNOWN_AUTHOR } from "./chain";
import type { EnrichmentQuery, ProviderId } from "./types";

/**
 * Spec 16 — the background enrichment run.
 *
 * Enqueued automatically when a scan completes. Persisted in the DB so a
 * server restart mid-run resumes rather than restarting, and bounded so a
 * Raspberry Pi is not hammered with outbound requests.
 */

/** Matches applied to at/above this are written without asking. Spec 16. */
export const AUTO_APPLY_CONFIDENCE = Number(process.env.AUTO_APPLY_CONFIDENCE ?? DEFAULT_CONFIDENCE_THRESHOLD);

/** Items processed at once. Deliberately low: this is a home server. */
const CONCURRENCY = Number(process.env.ENRICHMENT_CONCURRENCY ?? 2);

/** Pause between items, so a full-library pass is not a burst. */
const ITEM_DELAY_MS = Number(process.env.ENRICHMENT_ITEM_DELAY_MS ?? 250);

export interface RunOptions {
  /** Limit to one book (the manual spec 07 path). */
  mediaItemId?: number;
  /** Re-enrich even books already marked applied. */
  force?: boolean;
  threshold?: number;
}

export interface RunStatus {
  runId: number | null;
  status: string;
  queued: number;
  processed: number;
  applied: number;
  review: number;
  failed: number;
  skipped: number;
  message: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
}

function toStatus(run: {
  id: number;
  status: string;
  queued: number;
  processed: number;
  applied: number;
  review: number;
  failed: number;
  skipped: number;
  message: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
} | null): RunStatus {
  if (!run) {
    return {
      runId: null,
      status: "idle",
      queued: 0,
      processed: 0,
      applied: 0,
      review: 0,
      failed: 0,
      skipped: 0,
      message: null,
      startedAt: null,
      finishedAt: null,
    };
  }
  return {
    runId: run.id,
    status: run.status,
    queued: run.queued,
    processed: run.processed,
    applied: run.applied,
    review: run.review,
    failed: run.failed,
    skipped: run.skipped,
    message: run.message,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}

/** Build the search query for an item, including the LibriVox detection hint. */
export function buildQuery(item: {
  title: string;
  author: string;
  filePath: string;
}): EnrichmentQuery {
  return {
    title: item.title,
    author: item.author,
    authorIsUnknown: !item.author || item.author === UNKNOWN_AUTHOR,
    filePath: item.filePath,
    // Free-text the detection heuristic can read without a network call.
    hintText: item.filePath,
  };
}

export class EnrichmentManager {
  private running = false;

  constructor(private prisma: PrismaClient) {}

  /** Current status of the most recent run, for `GET /api/enrichment/status`. */
  async status(): Promise<RunStatus> {
    const run = await this.prisma.enrichmentRun.findFirst({ orderBy: { id: "desc" } });
    return toStatus(run);
  }

  /**
   * Enqueue an enrichment pass. Does not block: returns as soon as the run row
   * and its queue exist, so `POST /api/enrichment/run` responds immediately.
   */
  async enqueue(options: RunOptions = {}): Promise<RunStatus> {
    const items = await this.selectQueue(options);

    const run = await this.prisma.enrichmentRun.create({
      data: {
        status: "pending",
        queued: items.length,
        message: items.length === 0 ? "Nothing to enrich" : null,
        ...(items.length === 0 ? { finishedAt: new Date() } : {}),
      },
    });

    if (items.length === 0) return this.status();

    await this.prisma.enrichmentItem.createMany({
      data: items.map((item) => ({ runId: run.id, mediaItemId: item.id, status: "pending" })),
    });
    await this.prisma.mediaItem.updateMany({
      where: { id: { in: items.map((item) => item.id) } },
      data: { enrichmentStatus: "pending" },
    });

    // Fire and forget; the run persists its own progress.
    void this.process(run.id, options.threshold);
    return this.status();
  }

  private async selectQueue(options: RunOptions) {
    if (options.mediaItemId !== undefined) {
      const item = await this.prisma.mediaItem.findUnique({ where: { id: options.mediaItemId } });
      return item ? [item] : [];
    }
    return this.prisma.mediaItem.findMany({
      where: options.force ? {} : { NOT: { enrichmentStatus: "applied" } },
      orderBy: { id: "asc" },
    });
  }

  /**
   * Resume a run left `running` by a previous process. Called at boot.
   * Safe to call repeatedly — it no-ops when nothing is pending.
   */
  async resumeIncomplete(): Promise<void> {
    const stale = await this.prisma.enrichmentRun.findFirst({
      where: { status: { in: ["pending", "running"] } },
      orderBy: { id: "asc" },
    });
    if (stale) void this.process(stale.id);
  }

  private async process(runId: number, threshold?: number): Promise<void> {
    if (this.running) return; // one pass at a time; a second caller is a no-op
    this.running = true;

    try {
      await this.prisma.enrichmentRun.update({
        where: { id: runId },
        data: { status: "running", startedAt: new Date(), finishedAt: null },
      });

      const pending = await this.prisma.enrichmentItem.findMany({
        where: { runId, status: "pending" },
        include: { mediaItem: true },
        orderBy: { id: "asc" },
      });

      const limit = threshold ?? AUTO_APPLY_CONFIDENCE;
      let processed = 0;

      // Simple worker pool over the persisted queue. Each item commits its own
      // status, so a crash mid-run leaves accurate progress to resume from.
      const queue = [...pending];
      const workers = Array.from({ length: Math.max(1, CONCURRENCY) }, async () => {
        while (queue.length > 0) {
          const entry = queue.shift();
          if (!entry) return;
          await this.processOne(runId, entry.id, entry.mediaItemId, limit);
          processed += 1;
          await this.prisma.enrichmentRun.update({
            where: { id: runId },
            data: { processed },
          });
          if (ITEM_DELAY_MS > 0) await new Promise((resolve) => setTimeout(resolve, ITEM_DELAY_MS));
        }
      });
      await Promise.all(workers);

      await this.prisma.enrichmentRun.update({
        where: { id: runId },
        data: { status: "complete", finishedAt: new Date() },
      });
    } catch (error) {
      await this.prisma.enrichmentRun
        .update({
          where: { id: runId },
          data: {
            status: "error",
            message: error instanceof Error ? error.message : "enrichment run failed",
            finishedAt: new Date(),
          },
        })
        .catch(() => undefined);
    } finally {
      this.running = false;
    }
  }

  /** Enrich one item. Never throws — failures are recorded on the item. */
  private async processOne(
    runId: number,
    itemRowId: number,
    mediaItemId: number,
    threshold: number,
  ): Promise<void> {
    const setItem = (data: {
      status: string;
      provider?: ProviderId | null;
      confidence?: number | null;
      message?: string | null;
    }) =>
      this.prisma.enrichmentItem.update({
        where: { id: itemRowId },
        data: { status: data.status, provider: data.provider ?? null, confidence: data.confidence ?? null, message: data.message ?? null },
      });

    const bump = (field: "applied" | "review" | "failed" | "skipped") =>
      this.prisma.enrichmentRun
        .update({ where: { id: runId }, data: { [field]: { increment: 1 } } })
        .catch(() => undefined);

    try {
      const item = await this.prisma.mediaItem.findUnique({ where: { id: mediaItemId } });
      if (!item) {
        await setItem({ status: "skipped", message: "book no longer exists" });
        await bump("skipped");
        return;
      }

      const query = buildQuery(item);
      const result = await runChain(query, { threshold, collectAll: true });

      // ADR 009: fields a human has set are never written by enrichment.
      const overrides = await this.prisma.fieldOverride.findMany({
        where: { mediaItemId },
        select: { field: true },
      });
      const overriddenFields = new Set(overrides.map((row) => row.field));

      // Always store what we found, so the review queue has something to show
      // even when nothing cleared the auto-apply bar.
      await storeCandidates(this.prisma, mediaItemId, result.candidates);

      const best = result.best;
      if (!best) {
        await setItem({ status: "skipped", message: `no match (walked ${result.walked.join(", ")})` });
        await this.prisma.mediaItem.update({ where: { id: mediaItemId }, data: { enrichmentStatus: "skipped" } });
        await bump("skipped");
        return;
      }

      if (best.confidence < threshold) {
        await setItem({
          status: "review",
          provider: best.source,
          confidence: best.confidence,
          message: "below auto-apply threshold",
        });
        await this.prisma.mediaItem.update({ where: { id: mediaItemId }, data: { enrichmentStatus: "review" } });
        await bump("review");
        return;
      }

      await applyCandidate(this.prisma, item, best, { overriddenFields });
      await this.prisma.mediaItem.update({
        where: { id: mediaItemId },
        data: { enrichmentStatus: "applied", enrichedAt: new Date() },
      });
      await setItem({ status: "applied", provider: best.source, confidence: best.confidence });
      await bump("applied");
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      await setItem({ status: "failed", message });
      await this.prisma.mediaItem
        .update({ where: { id: mediaItemId }, data: { enrichmentStatus: "failed" } })
        .catch(() => undefined);
      await bump("failed");
    }
  }
}