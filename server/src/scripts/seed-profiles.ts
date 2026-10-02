/**
 * Seed the database with default household and testing profiles.
 * Safe to run multiple times — skips profiles that already exist.
 *
 * Usage:
 *   npm run seed:profiles
 */
import { PrismaClient } from "@prisma/client";
import { DEFAULT_PROFILES, seedDefaultProfiles } from "../seed";

const prisma = new PrismaClient();

async function main() {
  const created = await seedDefaultProfiles(prisma);
  for (const name of DEFAULT_PROFILES) {
    console.log(created.includes(name) ? `  Created "${name}"` : `  "${name}" already exists — skipping`);
  }
  console.log("Profile seed complete.");
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
