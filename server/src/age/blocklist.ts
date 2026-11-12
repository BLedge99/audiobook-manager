import type { PrismaClient } from "@prisma/client";
import type { AgeContext } from "./policy";

/**
 * Spec 38 / ADR 033 — loading the two runtime inputs the age gate needs.
 *
 * The genre blocklist is household configuration; one query per request is
 * fine at household scale and keeps call sites free of cache invalidation.
 *
 * A child session without a profile id (impossible today; possible for a
 * break-glass household session) fails closed to the strictest band.
 */

export async function blockedGenreIds(prisma: PrismaClient): Promise<Set<number>> {
  const rows = await prisma.blocklistGenre.findMany({ select: { genreId: true } });
  return new Set(rows.map((row) => row.genreId));
}

export async function ageContextFor(
  prisma: PrismaClient,
  role: string | undefined,
  profileId: number | null,
): Promise<AgeContext> {
  if (role !== "child") return { role: role ?? "member", ageBand: null };
  if (profileId == null) return { role: "child", ageBand: null }; // fail closed
  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    select: { ageBand: true },
  });
  return { role: "child", ageBand: profile?.ageBand ?? null };
}
