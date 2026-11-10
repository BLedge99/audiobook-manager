import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Spec 35 / ADR 026 -- the production PostgreSQL database must not be reachable
 * through Supabase's public API.
 *
 * The server authenticates its own sessions (ADR 016, ADR 023) and never uses
 * Supabase Auth, PostgREST or the anon key. Supabase nevertheless grants every
 * table in the `public` schema to the `anon` and `authenticated` roles, so
 * without Row-Level Security the whole library -- profiles, e-mail addresses,
 * password hashes -- is readable and writable by anyone holding the project's
 * public anon key.
 *
 * RLS lives in the database, so it cannot be asserted by the SQLite suite.
 * These checks read the PostgreSQL migration history instead and hold it to:
 *
 *  - every table the schema declares has RLS enabled,
 *  - RLS is never FORCED (that would bind the owner role the server uses),
 *  - the blanket grants to `anon` and `authenticated` are revoked, for the
 *    tables that exist and for the ones created later,
 *  - the whole `public` schema is swept, so a table this repository does not
 *    own is covered too.
 */

const SERVER_ROOT = path.join(__dirname, "..");
const SCHEMA = path.join(SERVER_ROOT, "prisma", "schema.prisma");
const MIGRATIONS = path.join(SERVER_ROOT, "prisma", "migrations");

/** Model names, and the table each maps to (`@@map` when it is set). */
function schemaTables(): string[] {
  const source = readFileSync(SCHEMA, "utf8");
  const tables: string[] = [];
  for (const block of source.split(/^model\s+/m).slice(1)) {
    const name = /^\s*(\w+)\s*\{/.exec(block)?.[1];
    if (!name) continue;
    const mapped = /@@map\("([^"]+)"\)/.exec(block)?.[1];
    tables.push(mapped ?? name);
  }
  return tables.sort();
}

function migrationFiles(root: string): string[] {
  return readdirSync(root)
    .filter((entry) => statSync(path.join(root, entry)).isDirectory())
    .map((entry) => path.join(root, entry, "migration.sql"))
    .filter((file) => {
      try {
        statSync(file);
        return true;
      } catch {
        return false;
      }
    })
    .sort();
}

/**
 * The executable SQL only. A migration may explain itself in a comment, and a
 * comment that says "FORCE ROW LEVEL SECURITY is deliberately not used" must
 * not read as a statement that uses it.
 */
function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
}

function migrationHistory(): string {
  return stripComments(
    migrationFiles(MIGRATIONS)
      .map((file) => readFileSync(file, "utf8"))
      .join("\n"),
  );
}

/** The string lists the migration iterates over (`FOREACH ... IN ARRAY ARRAY[...]`). */
function foreachLists(sql: string): string[][] {
  const lists: string[][] = [];
  for (const match of sql.matchAll(/FOREACH\s+\w+\s+IN\s+ARRAY\s+ARRAY\[([\s\S]*?)\]\s+LOOP/g)) {
    lists.push([...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]));
  }
  return lists;
}

/**
 * Every table the history protects. Two forms are accepted:
 *
 *  - the list in the RLS migration itself (`FOREACH ... IN ARRAY ARRAY[...]`),
 *  - a plain `ALTER TABLE "X" ENABLE ROW LEVEL SECURITY;` in a later migration,
 *    which is how a table added after spec 35 is protected.
 */
function protectedTables(history: string): string[] {
  const listed = foreachLists(history).find((list) => list.includes("LibraryRoot")) ?? [];
  const statements = [...history.matchAll(/ALTER TABLE "([^"]+)" ENABLE ROW LEVEL SECURITY;/g)].map(
    (match) => match[1],
  );
  return [...new Set([...listed, ...statements])].sort();
}

describe("PostgreSQL row-level security", () => {
  it("enables RLS on every table the schema declares, and on no table it does not", () => {
    expect(protectedTables(migrationHistory())).toEqual(schemaTables());
  });

  it("never forces RLS, which would bind the owner role the server connects as", () => {
    expect(migrationHistory()).not.toMatch(/FORCE\s+ROW\s+LEVEL\s+SECURITY/i);
  });

  it("revokes the default anon and authenticated grants on current and future tables", () => {
    const history = migrationHistory();

    expect(history).toMatch(/REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I/);
    expect(history).toMatch(/REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I/);
    expect(history).toMatch(/ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I/);
    expect(history).toMatch(/ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I/);
    // Both roles, not just `anon`.
    expect(foreachLists(history)).toContainEqual(["anon", "authenticated"]);
  });

  it("sweeps the whole public schema so an unowned table is covered too", () => {
    const history = migrationHistory();

    expect(history).toMatch(/nspname = 'public'/);
    expect(history).toMatch(/ALTER TABLE public\.%I ENABLE ROW LEVEL SECURITY/);
  });

  it("keeps the SQLite history free of RLS, which SQLite does not implement", () => {
    const sqliteMigrations = path.join(SERVER_ROOT, "prisma", "sqlite", "migrations");
    const sql = migrationFiles(sqliteMigrations)
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    expect(sql).not.toMatch(/ROW LEVEL SECURITY/i);
  });
});
