/**
 * Per-test-file SQLite database.
 *
 * Every test file gets its own copy of the schema template built once by the
 * Vitest global setup. Copying a file replaces the previous pattern of running
 * `prisma db push` (and therefore `prisma generate`) in every integration test,
 * which raced across parallel workers and left the generated client pointing at
 * whichever provider won last.
 */
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const TEMPLATE = path.join(
  process.cwd(),
  "node_modules",
  ".cache",
  "audiobook-tests",
  "template.db",
);

export interface TestDatabase {
  /** Ready-to-use Prisma URL. */
  url: string;
  /** The temp directory that holds the database file. */
  dir: string;
  /** Remove the temp directory. Safe to call more than once. */
  cleanup: () => void;
}

/**
 * Create an isolated database for one test file and point Prisma at it.
 *
 * Call this at module scope so the URL is set before the first
 * `new PrismaClient()` in `beforeAll`.
 */
export function createTestDatabase(prefix = "audiobook-test-"): TestDatabase {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  const file = path.join(dir, "test.db");
  copyFileSync(TEMPLATE, file);

  const url = `file:${file.replace(/\\/g, "/")}`;
  process.env.DATABASE_URL = url;

  return {
    url,
    dir,
    cleanup: () => {
      // SQLite can hold a handle briefly on Windows; a failed temp cleanup must
      // not fail an otherwise-green suite.
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    },
  };
}
