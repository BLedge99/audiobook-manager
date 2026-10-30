/**
 * One-time setup for the server test suite.
 *
 * The tests run against SQLite (fast, isolated, no external service) while
 * production runs against PostgreSQL. Prisma bakes the provider into the
 * generated client, so the client must be generated for SQLite before any test
 * imports `@prisma/client`.
 *
 * This file is the only place that may generate the client or build the test
 * schema. It used to happen in every integration test's `beforeAll`, which
 * meant ~14 workers ran `prisma generate` concurrently against the same
 * `node_modules/.prisma/client` directory. Whichever finished last decided the
 * provider for the whole run, so the suite passed or failed depending on
 * timing.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

const serverRoot = process.cwd();
const sqliteSchema = path.join(serverRoot, "prisma", "sqlite", "schema.prisma");
const cacheDir = path.join(serverRoot, "node_modules", ".cache", "audiobook-tests");

/** Read-only template every test file copies. Exported for the helper. */
export const TEST_DATABASE_TEMPLATE = path.join(cacheDir, "template.db");

function prisma(args: string, databaseUrl: string): void {
  execSync(`npx prisma ${args}`, {
    cwd: serverRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "ignore",
  });
}

export function setup(): void {
  if (!existsSync(sqliteSchema)) {
    throw new Error(
      `Missing ${sqliteSchema}. Run "npm run db:sqlite:sync" to derive it from prisma/schema.prisma.`,
    );
  }

  // A stale twin would silently test the wrong model. Fail before doing any work.
  execSync("node scripts/sync-sqlite-schema.mjs --check", {
    cwd: serverRoot,
    stdio: "inherit",
  });

  rmSync(cacheDir, { recursive: true, force: true });
  mkdirSync(cacheDir, { recursive: true });

  // Prisma accepts forward slashes on every platform; Windows paths in a
  // `file:` URL otherwise need escaping.
  const templateUrl = `file:${TEST_DATABASE_TEMPLATE.replace(/\\/g, "/")}`;

  // Generate the SQLite client once, then build the template database from the
  // real SQLite migrations. Using migrations (not `db push`) means a model
  // change without a matching migration fails the suite instead of passing
  // against a schema production would never create.
  prisma(`generate --schema "${sqliteSchema}"`, templateUrl);
  prisma(`migrate deploy --schema "${sqliteSchema}"`, templateUrl);
}

export function teardown(): void {
  // SQLite keeps handles briefly on Windows; cleanup is best-effort.
  try {
    rmSync(cacheDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}
