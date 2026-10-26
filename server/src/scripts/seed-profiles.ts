/**
 * Seed the database with default household and testing profiles.
 * Safe to run multiple times — skips profiles that already exist.
 *
 * Usage:
 *   npm run seed:profiles
 */
import { PrismaClient } from "@prisma/client";
import { DEFAULT_PROFILES, TEST_PROFILES, seedDefaultProfiles } from "../seed";

const prisma = new PrismaClient();

async function main() {
  const created = await seedDefaultProfiles(prisma);
  const wanted = process.env.SEED_TEST_ACCOUNTS === "true"
    ? [...DEFAULT_PROFILES, ...TEST_PROFILES]
    : DEFAULT_PROFILES;
  for (const { name, role } of wanted) {
    console.log(
      created.includes(name)
        ? `  Created "${name}" (${role})`
        : `  "${name}" already exists — skipping`,
    );
  }
  console.log("Profile seed complete.");
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
