import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { executeReadOnlyQuery, validateReadOnlySql } from "./read-only-sql";

/**
 * The console renders 500 rows; anything larger must be capped inside the
 * SQL, not after it is loaded into memory. `SELECT * FROM t` on a million-row
 * table used to be read whole and sliced afterwards.
 */
describe("executeReadOnlyQuery", () => {
  let savedDatabaseUrl: string | undefined;

  beforeAll(() => {
    // The SQLite branch validates DATABASE_URL before using a shared,
    // caller-supplied connection.
    savedDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "file::memory:";
  });

  afterAll(() => {
    if (savedDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedDatabaseUrl;
  });

  function fixture() {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, label TEXT)");
    const insert = db.prepare("INSERT INTO t (label) VALUES (?)");
    const bulk = db.transaction((n: number) => {
      for (let i = 0; i < n; i += 1) insert.run(`row-${i}`);
    });
    bulk(1_000);
    return db;
  }

  it("caps a bare SELECT at 501 rows inside the SQL", async () => {
    const db = fixture();
    try {
      const rows = (await executeReadOnlyQuery("sqlite", "SELECT id, label FROM t", db as never)) as unknown[];
      // One extra row past the 500 the route renders, so the route can tell
      // "exactly 500 rows" from "more than 500".
      expect(rows).toHaveLength(501);
    } finally {
      db.close();
    }
  });

  it("caps an ordered SELECT without changing its first rows", async () => {
    const db = fixture();
    try {
      const rows = (await executeReadOnlyQuery(
        "sqlite",
        "SELECT id, label FROM t ORDER BY id DESC",
        db as never,
      )) as { id: number }[];
      expect(rows).toHaveLength(501);
      expect(rows[0]?.id).toBe(1_000);
    } finally {
      db.close();
    }
  });

  it("runs PRAGMA statements unwrapped (they cannot be subqueried)", async () => {
    const db = fixture();
    try {
      const rows = (await executeReadOnlyQuery("sqlite", "PRAGMA table_info(t)", db as never)) as unknown[];
      expect(rows.length).toBeGreaterThanOrEqual(2);
    } finally {
      db.close();
    }
  });

  it("still rejects write statements", async () => {
    const db = fixture();
    try {
      await expect(executeReadOnlyQuery("sqlite", "DELETE FROM t", db as never)).rejects.toThrow();
    } finally {
      db.close();
    }
  });

  it("redacts bcrypt-shaped values under ANY column name — the alias bypass", async () => {
    // The key-name filter cannot see `SELECT passwordHash AS digest`; the value
    // is what the operator must not get. Offline-crackable bcrypt material is
    // the load-bearing case.
    const db = new Database(":memory:");
    try {
      db.exec("CREATE TABLE cred (id INTEGER PRIMARY KEY, digest TEXT)");
      db.prepare("INSERT INTO cred (digest) VALUES (?)").run(
        "$2b$10$N9qo8uLOickgx2ZMRZoMye3FTfD6BQmHcQUdh5pFc8N9b3r0n0l7u",
      );
      const rows = (await executeReadOnlyQuery(
        "sqlite",
        "SELECT digest AS hidden_note FROM cred",
        db as never,
      )) as { hidden_note: string }[];
      expect(rows[0]?.hidden_note).toBe("[redacted]");
    } finally {
      db.close();
    }
  });

  it("redacts argon2-shaped values too", async () => {
    const db = new Database(":memory:");
    try {
      db.exec("CREATE TABLE cred (id INTEGER PRIMARY KEY, digest TEXT)");
      db.prepare("INSERT INTO cred (digest) VALUES (?)").run("$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$something");
      const rows = (await executeReadOnlyQuery(
        "sqlite",
        "SELECT digest AS also_hidden FROM cred",
        db as never,
      )) as { also_hidden: string }[];
      expect(rows[0]?.also_hidden).toBe("[redacted]");
    } finally {
      db.close();
    }
  });

  it("leaves ordinary strings and hex-shaped enrichment data untouched", async () => {
    const db = new Database(":memory:");
    try {
      db.exec("CREATE TABLE t2 (id INTEGER PRIMARY KEY, note TEXT, digest TEXT)");
      db.prepare("INSERT INTO t2 (note, digest) VALUES (?, ?)").run(
        "a normal description",
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      );
      const rows = (await executeReadOnlyQuery(
        "sqlite",
        "SELECT note, digest AS alias_digest FROM t2",
        db as never,
      )) as { note: string; alias_digest: string }[];
      expect(rows[0]?.note).toBe("a normal description");
      expect(rows[0]?.alias_digest).toBe(
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      );
    } finally {
      db.close();
    }
  });
});

describe("validateReadOnlySql — server-side function blocklist", () => {
  // BEGIN READ ONLY blocks writes, not these: signal/lock/config/side-effect
  // functions that a SELECT can call. DATABASE_URL may be a managed role with
  // broad rights (e.g. Supabase postgres), so the console must not rely on it.
  const forbidden = [
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity",
    "SELECT pg_cancel_backend(pid) FROM pg_stat_activity",
    "SELECT pg_reload_conf()",
    "SELECT pg_rotate_logfile()",
    "SELECT pg_stat_file('/etc/passwd')",
    "SELECT pg_advisory_lock(1)",
    "SELECT lo_import('/etc/passwd')",
    "SELECT lo_export(1, '/tmp/x')",
    "SELECT lo_unlink(1)",
    "SELECT pg_read_binary_file('/etc/passwd')",
    "SELECT pg_ls_waldir()",
    "SELECT pg_ls_logdir()",
    "SELECT pg_backup_start('label')",
    "SELECT pg_backup_stop()",
    "SELECT pg_notify('channel', 'payload')",
    "SELECT nextval('seq')",
    "SELECT setval('seq', 1)",
    "EXPLAIN ANALYZE SELECT nextval('seq')",
  ];
  for (const sql of forbidden) {
    it(`rejects: ${sql.slice(7, 40)}…`, () => {
      expect(validateReadOnlySql(sql)).toBeTruthy();
    });
  }

  it("still allows an ordinary bounded read", () => {
    expect(validateReadOnlySql("SELECT COUNT(*) FROM MediaItem")).toBeNull();
    expect(validateReadOnlySql("PRAGMA table_info(t)")).toBeNull();
  });

  it("does not leak absolute file paths via PRAGMA database_list", () => {
    expect(validateReadOnlySql("PRAGMA database_list")).toBeTruthy();
  });
});
