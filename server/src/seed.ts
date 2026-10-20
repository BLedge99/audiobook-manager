/**
 * Default household profiles, seeded on first boot of an empty
 * database. Shared by the server entrypoint and the seed script.
 */
import type { PrismaClient } from "@prisma/client";
import { giveProfileEveryBook } from "./library-membership";

export const DEFAULT_PROFILES = ["Dad", "Mum", "Archie", "Ben", "Playwright", "Testing"];

/**
 * Create any default profiles that don't exist yet.
 * Idempotent — safe to run on every startup and manually.
 * Returns the names that were created.
 *
 * ## Spec 27: the default profiles follow the server library
 *
 * They are the household's standing profiles, seeded once at setup rather
 * than chosen by a person for one person, so they behave like the profiles
 * that existed when spec 27 shipped: they receive newly scanned books without
 * anyone touching them.
 *
 * The consequence is that a fresh install looks exactly like a migrated one.
 * A profile created *in the app* is different — it starts empty, which is the
 * spec's decision and is implemented in the profile creation route.
 */
export async function seedDefaultProfiles(prisma: PrismaClient): Promise<string[]> {
  const created: string[] = [];
  for (const name of DEFAULT_PROFILES) {
    const existing = await prisma.profile.findUnique({ where: { name } });
    if (existing) {
      // An existing default profile might predate spec 27 and still be
      // flagged as not following. Bring it in line, and give it the books it
      // would have had.
      if (!existing.followsServerLibrary) {
        await prisma.profile.update({
          where: { id: existing.id },
          data: { followsServerLibrary: true },
        });
        await giveProfileEveryBook(prisma, existing.id);
      }
      continue;
    }
    const profile = await prisma.profile.create({
      data: { name, followsServerLibrary: true },
    });
    // A brand new profile has no books yet on a first boot -- the scan has not
    // run. The scanner adds them as they are found.
    await giveProfileEveryBook(prisma, profile.id);
    created.push(name);
  }
  return created;
}
