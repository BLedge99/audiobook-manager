import type { PrismaClient } from "@prisma/client";
import type { AgeContext } from "./policy";

/**
 * Spec 38 / ADR 033 — loading the household genre blocklist.
 *
 * Household configuration; one query per request is fine at household scale
 * and keeps call sites free of cache invalidation.
 */
export async function blockedGenreIds(prisma: PrismaClient): Promise<Set<number>> {
  const rows = await prisma.blocklistGenre.findMany({ select: { genreId: true } });
  return new Set(rows.map((row) => row.genreId));
}
