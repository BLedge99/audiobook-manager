#!/usr/bin/env node
/**
 * Keep the SQLite schema in lockstep with the canonical PostgreSQL schema.
 *
 * Prisma allows exactly one datasource provider per schema file, and the
 * generated client is tied to that provider. Production needs PostgreSQL;
 * local development and the test suite need SQLite. Rather than hand-editing a
 * second schema and letting the two drift, this script derives the SQLite
 * schema from `prisma/schema.prisma` by changing only the provider line.
 *
 * Usage:
 *   node scripts/sync-sqlite-schema.mjs          # write prisma/sqlite/schema.prisma
 *   node scripts/sync-sqlite-schema.mjs --check  # exit 1 if it is stale
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(serverRoot, "prisma", "schema.prisma");
const targetPath = join(serverRoot, "prisma", "sqlite", "schema.prisma");

const PROVIDER_LINE = /provider\s*=\s*"postgresql"/;

const canonical = readFileSync(sourcePath, "utf8");
if (!PROVIDER_LINE.test(canonical)) {
  console.error(
    `[sync-sqlite-schema] ${sourcePath} does not declare a postgresql provider; refusing to guess.`,
  );
  process.exit(1);
}

// Only the provider changes. Every model, index and relation stays byte-for-byte
// identical, which is what makes the SQLite test schema trustworthy.
const sqlite = canonical.replace(PROVIDER_LINE, 'provider = "sqlite"');

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(targetPath, "utf8");
  } catch {
    // Missing counts as stale.
  }
  if (current !== sqlite) {
    console.error(
      "[sync-sqlite-schema] prisma/sqlite/schema.prisma is out of date.\n" +
        "Run: npm run db:sqlite:sync",
    );
    process.exit(1);
  }
  console.log("[sync-sqlite-schema] SQLite schema is in sync.");
} else {
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, sqlite);
  console.log("[sync-sqlite-schema] wrote prisma/sqlite/schema.prisma");
}
