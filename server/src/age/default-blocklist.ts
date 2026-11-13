/**
 * Spec 38 / ADR 033 — the default genre blocklist, seeded once per installation.
 *
 * A reasonable starting set an unhinted household can ship with: genres where
 * "suitable for children" is the exception, not the rule.
 *
 *  - erotica          — sexual content
 *  - horror           — violence and gore
 *  - true-crime       — real-world violence
 *
 * The admin can add or remove any genre at any time; the bootstrap runs only
 * when the `GenreBlocklistSeed` marker is absent, which happens at most once
 * per installation. An admin who empties the blocklist keeps it empty on
 * every subsequent boot.
 *
 * If the taxonomy has not been seeded yet (a fresh install on first boot, or a
 * household that deleted the taxonomy seed), no rows are inserted and no marker
 * is written — the seed is attempted again on the next boot.
 */
import type { PrismaClient } from "@prisma/client";

export const DEFAULT_BLOCKLIST_SLUGS = ["erotica", "horror", "true-crime"] as const;

export async function seedDefaultBlocklist(prisma: PrismaClient): Promise<number> {
  const seeded = await prisma.genreBlocklistSeed.findUnique({ where: { id: 1 } });
  if (seeded) return 0;

  const existing = await prisma.blocklistGenre.count();
  const genres = existing === 0
    ? await prisma.genre.findMany({
        where: { slug: { in: [...DEFAULT_BLOCKLIST_SLUGS] } },
        select: { id: true },
      })
    : [];

  // No taxonomy yet → do not burn the marker; try again next boot.
  if (existing === 0 && genres.length === 0) return 0;

  await prisma.$transaction(async (tx) => {
    if (genres.length > 0) {
      await tx.blocklistGenre.createMany({ data: genres.map((genre) => ({ genreId: genre.id })) });
    }
    await tx.genreBlocklistSeed.create({ data: { id: 1 } });
  });
  return genres.length;
}
