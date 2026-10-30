import { describe, it, expect, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The project runs on two databases: PostgreSQL in production, SQLite for local
 * development and this test suite. Prisma supports one provider per schema, so
 * the SQLite schema is derived from the PostgreSQL one by
 * `scripts/sync-sqlite-schema.mjs`. These tests are what stop that arrangement
 * from drifting behind the project's back:
 *
 *  - the two schemas must describe the same models, and
 *  - the SQLite migration history must produce exactly that schema.
 *
 * Production migrations are checked separately against a real PostgreSQL
 * shadow database (see the README next to the migrations); they cannot be
 * replayed on SQLite.
 */

const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* Windows can hold the SQLite handle briefly */
    }
  }
});

function run(command: string): void {
  execSync(command, { cwd: process.cwd(), stdio: "pipe" });
}

describe("database schemas", () => {
  it("keeps the SQLite schema identical to PostgreSQL apart from the provider", () => {
    expect(() => run("node scripts/sync-sqlite-schema.mjs --check")).not.toThrow();
  });

  it("has SQLite migrations that produce the current SQLite schema", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "audiobook-schema-diff-"));
    dirs.push(dir);
    const shadow = `file:${path.join(dir, "shadow.db").replace(/\\/g, "/")}`;

    expect(() =>
      run(
        "npx prisma migrate diff " +
          "--from-migrations prisma/sqlite/migrations " +
          "--to-schema-datamodel prisma/sqlite/schema.prisma " +
          `--shadow-database-url "${shadow}" ` +
          "--exit-code",
      ),
    ).not.toThrow();
  }, 120_000);
});
