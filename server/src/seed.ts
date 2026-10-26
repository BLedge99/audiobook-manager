/**
 * Default household profiles, seeded on first boot of an empty database.
 * Shared by the server entrypoint and the seed script.
 *
 * Spec 28: the default set is `admin` plus the household members. `Archie` is
 * deliberately not seeded on a fresh install; a database that already has him
 * keeps him. The two test accounts are only created when
 * `SEED_TEST_ACCOUNTS=true`, so a production database never gets a known
 * password.
 */
import type { PrismaClient } from "@prisma/client";
import { giveProfileEveryBook } from "./library-membership";
import { hashPassword, validatePassword } from "./auth/password";

export interface DefaultProfile {
  name: string;
  role: "admin" | "member";
}

export const DEFAULT_PROFILES: DefaultProfile[] = [
  { name: "admin", role: "admin" },
  { name: "Dad", role: "member" },
  { name: "Mum", role: "member" },
  { name: "Ben", role: "member" },
];

export const TEST_PROFILES: DefaultProfile[] = [
  { name: "test", role: "member" },
  { name: "admin-test", role: "admin" },
];

function testProfilesEnabled(): boolean {
  return process.env.SEED_TEST_ACCOUNTS === "true";
}

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
  const wanted = testProfilesEnabled()
    ? [...DEFAULT_PROFILES, ...TEST_PROFILES]
    : DEFAULT_PROFILES;
  const created: string[] = [];

  for (const descriptor of wanted) {
    const existing = await prisma.profile.findUnique({ where: { name: descriptor.name } });
    if (existing) {
      // An existing default profile might predate spec 27 and still be
      // flagged as not following. Bring it in line, and give it the books it
      // would have had. Never downgrade an existing admin.
      const role = descriptor.role === "admin" ? "admin" : existing.role;
      if (!existing.followsServerLibrary || role !== existing.role) {
        await prisma.profile.update({
          where: { id: existing.id },
          data: { followsServerLibrary: true, role },
        });
        await giveProfileEveryBook(prisma, existing.id);
      }
      continue;
    }

    // A test account gets a known password only when the environment supplies
    // one. A missing or invalid value leaves the account unclaimed rather than
    // inventing a weak default.
    let passwordHash: string | null = null;
    if (descriptor.name === "test" || descriptor.name === "admin-test") {
      const envName = descriptor.name === "test"
        ? "TEST_PROFILE_PASSWORD"
        : "ADMIN_TEST_PROFILE_PASSWORD";
      const password = process.env[envName];
      if (password && validatePassword(password, descriptor.name) === null) {
        passwordHash = await hashPassword(password);
      }
    }

    const profile = await prisma.profile.create({
      data: {
        name: descriptor.name,
        role: descriptor.role,
        followsServerLibrary: true,
        passwordHash,
        passwordUpdatedAt: passwordHash ? new Date() : null,
      },
    });
    // A brand new profile has no books yet on a first boot -- the scan has not
    // run. The scanner adds them as they are found.
    await giveProfileEveryBook(prisma, profile.id);
    created.push(descriptor.name);
  }
  return created;
}
