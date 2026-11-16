/**
 * Spec 43 phase 7.3: the cover-retry counter.
 *
 * Every enrichment pass that ends coverless increments the counter; one that
 * ends with a cover resets it. The selection queue
 * (`selectQueue`, ENRICH_COVER_MAX_RETRIES, default 3) stops re-enqueuing a
 * coverless book once the counter reaches the cap — a book whose provider
 * simply never has art stops burning API calls and scan time.
 */
import type { PrismaLike } from "../prisma-like";

export async function recordCoverOutcome(prisma: PrismaLike, mediaItemId: number): Promise<void> {
  try {
    const after = await prisma.mediaItem.findUnique({
      where: { id: mediaItemId },
      select: { coverImagePath: true, coverRetryCount: true },
    });
    if (!after) return;
    if (after.coverImagePath) {
      if (after.coverRetryCount > 0) {
        await prisma.mediaItem.update({
          where: { id: mediaItemId },
          data: { coverRetryCount: 0 },
        });
      }
    } else {
      await prisma.mediaItem.update({
        where: { id: mediaItemId },
        data: { coverRetryCount: { increment: 1 } },
      });
    }
  } catch {
    // A counter must never fail an enrichment pass.
  }
}
