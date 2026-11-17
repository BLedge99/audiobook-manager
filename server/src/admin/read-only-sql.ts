import Database from "better-sqlite3";
import { Client as PgClient } from "pg";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type SqliteConnection = InstanceType<typeof Database>;

export const ADMIN_DB_TABLES = [
  "LibraryRoot", "MediaItem", "Track", "ScanState", "Profile", "Session",
  "AdminSession", "ProfileLibraryEntry", "ListeningHistory",
  "PlaySession", "Favourite", "Tag", "MediaItemTag", "WishlistItem", "EnrichmentRun",
  "EnrichmentItem", "MetadataCandidate", "Contributor", "ContributorMediaItem",
  "Genre", "GenreMapping", "MediaItemGenre", "Series", "FieldOverride", "WebAuthnCredential",
] as const;

/**
 * Columns that never leave this console, on any provider — credential hashes
 * and one-time ceremony material. Tables carrying them (Profile.passwordHash,
 * Session/AdminSession.tokenHash) stay browsable for row inspection and
 * relationships; these columns and their names do not.
 */
export const ADMIN_SECRET_COLUMNS = [
  "passwordhash",
  "tokenhash",
  "codehash",
  "statehash",
  "challenge",
] as const;

/** Strip denied column names (case-insensitive) from a columns array. */
export function stripSecretColumnNames(
  columns: unknown[],
  nameOf: (column: unknown) => string,
): unknown[] {
  return columns.filter((column) => {
    const name = nameOf(column).toLowerCase();
    return !(ADMIN_SECRET_COLUMNS as readonly string[]).includes(name);
  });
}

/** bcrypt ($2a$/$2b$/$2y$) and argon2 ($argon2id$…) — offline-crackable
 *  material. The key filter cannot see aliases; the value cannot hide behind
 *  one. Both providers run every row through this. Family code never leaks
 *  them; the free-form console is the surface that needs it. */
const CRACKABLE = [/^\$2[aby]\$\d{2}\$/, /^\$argon2(id|i|d)\$/];

/** Redact every string value that is unmistakably a password hash. */
export function scrubSecretValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return CRACKABLE.some((re) => re.test(value)) ? "[redacted]" : value;
}

/** Strip denied keys (case-insensitive) from a result row, and redact
 *  crackable values under whatever key they hide in. */
export function stripSecretColumns(row: unknown): unknown {
  if (row === null || typeof row !== "object" || Array.isArray(row)) return row;
  const out: Record<string, unknown> = {};
  const denied = ADMIN_SECRET_COLUMNS as readonly string[];
  for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
    if (denied.includes(key.toLowerCase())) continue;
    out[key] = scrubSecretValue(value);
  }
  return out;
}

export type AdminDbTable = typeof ADMIN_DB_TABLES[number];

export function validateReadOnlySql(sql: string): string | null {
  const trimmed = sql.trim();
  if (!trimmed || trimmed.length > 10_000) return "Enter a query up to 10,000 characters.";
  // A single statement only. Semicolons inside quoted strings are conservatively
  // rejected as well; the console is for inspection, not scripting.
  if (trimmed.replace(/;\s*$/, "").includes(";")) return "Only one statement is allowed.";
  if (!/^(select|explain|pragma)\b/i.test(trimmed)) return "Only SELECT, EXPLAIN, or read-only PRAGMA statements are allowed.";
  // Writes, admin operations and side-effecting server-side functions are all
  // refused. The regex is not a parser — quoted strings containing these words
  // are rejected too (use the console for inspection, not for crafting data).
  if (/\b(insert|update|delete|replace|create|alter|drop|attach|detach|vacuum|reindex|analyze|begin|commit|rollback|grant|revoke|truncate|copy|call|do|into|outfile|dumpfile|load_file|load_extension|set_config|pg_read_file|pg_read_binary_file|pg_ls_dir|pg_ls_waldir|pg_ls_logdir|pg_ls_archive_statusdir|pg_stat_file|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|pg_rotate_logfile|pg_advisory_lock|pg_advisory_unlock|pg_advisory_xact_lock|lo_import|lo_export|lo_unlink|pg_backup_start|pg_backup_stop|pg_notify|pg_promote|pg_wal_replay_pause|pg_wal_replay_resume|nextval|setval|dblink)\b/i.test(trimmed)) {
    return "Write or administrative statements are not allowed.";
  }
  if (/^pragma\s+(?!table_info\b|table_xinfo\b|foreign_key_list\b|index_list\b|index_info\b|compile_options\b)/i.test(trimmed)) {
    return "This PRAGMA is not in the read-only allowlist.";
  }
  if (/^pragma\b/i.test(trimmed) && /=/.test(trimmed)) {
    return "PRAGMA assignments are not allowed.";
  }
  return null;
}

/**
 * Execute one validated read-only statement.
 *
 * `sqliteConnection`, when given, runs on the admin app's shared readonly
 * connection instead of opening a one-off connection per statement (spec 37,
 * X.10: one driver connection per process, not one per request). The
 * free-form entry point stays available for tests and standalone callers.
 */
/** The console renders 500 rows; the SQL hands it one more to flag truncation. */
export const ADMIN_ROW_LIMIT = 500;

const SELECT_LIKE = /^\s*select\b/i;

function capStatement(statement: string): string {
  if (!SELECT_LIKE.test(statement)) return statement;
  return `SELECT * FROM (\n${statement}\n) AS capped LIMIT ${ADMIN_ROW_LIMIT + 1}`;
}

export async function executeReadOnlyQuery(
  provider: "sqlite" | "postgresql",
  sql: string,
  sqliteConnection?: SqliteConnection | null,
) {
  const invalid = validateReadOnlySql(sql);
  if (invalid) throw new Error(invalid);
  const statement = capStatement(sql.trim().replace(/;\s*$/, ""));
  if (provider === "sqlite") {
    const raw = process.env.DATABASE_URL ?? "";
    if (!raw.startsWith("file:")) throw new Error("SQLite database path is not configured.");
    const shared = sqliteConnection ?? null;
    const own = shared ?? (() => {
      const rawPath = raw.slice("file:".length).split("?")[0];
      let filename: string;
      try { filename = new URL(raw).protocol === "file:" ? fileURLToPath(raw.split("?")[0]) : path.resolve(process.cwd(), decodeURIComponent(rawPath)); }
      catch { filename = path.resolve(process.cwd(), decodeURIComponent(rawPath)); }
      return new Database(filename, { readonly: true, fileMustExist: true, timeout: 5_000 });
    })();
    // LIMITATIONS: better-sqlite3 executes synchronously on the Node event
    // loop; a hostile/accidental cross-join can starve the process. The 5s
    // `timeout` is a busy timeout, not a compute deadline, and row-capping does
    // not bound work. Accepted for the single-operator console; if this ever
    // becomes multi-user, run queries in a worker with an interrupt.
    try {
      own.pragma("query_only = ON");
      const query = own.prepare(statement);
      if (!query.reader) throw new Error("Only read-only statements are allowed.");
      return query.all().map(stripSecretColumns);
    } finally {
      if (!shared) own.close();
    }
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("PostgreSQL database URL is not configured.");
  const client = new PgClient({ connectionString: url, connectionTimeoutMillis: 5_000, statement_timeout: 5_000 });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    try {
      const result = await client.query(statement);
      await client.query("COMMIT");
      return result.rows.map(stripSecretColumns);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally { await client.end(); }
}
