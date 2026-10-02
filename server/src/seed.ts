/**
 * Default household profiles, seeded on first boot of an empty
 * database. Shared by the server entrypoint and the seed script.
 */
import type { PrismaClient } from "@prisma/client";

export const DEFAULT_PROFILES = ["Dad", "Mum", "Archie", "Ben", "Playwright", "Testing"];

/**
 * Create any default profiles that don't exist yet.
 * Idempotent — safe to run on every startup and manually.
 * Returns the names that were created.
 */
export async function seedDefaultProfiles(prisma: PrismaClient): Promise<string[]> {
  const created: string[] = [];
  for (const name of DEFAULT_PROFILES) {
    const existing = await prisma.profile.findUnique({ where: { name } });
    if (existing) continue;
    await prisma.profile.create({ data: { name } });
    created.push(name);
  }
  return created;
}
