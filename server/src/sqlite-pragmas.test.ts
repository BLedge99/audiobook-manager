import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { createTestDatabase } from "./test-support/database";

/**
 * Spec 43 phase 1.2: WAL mode persists in the database file and gives the
 * single-writer SQLite real reader/writer concurrency while the scanner holds
 * a transaction. busy_timeout is per-connection and is therefore asserted on
 * a directly-opened handle here — Prisma's SQLite engine applies its own
 * semantics and exposes no knob, which is why short transactions are the
 * primary control (see spec 43 phase 1.2).
 */
describe("sqlite template pragmas", () => {
  const db = createTestDatabase("audiobook-pragmas-");

  it("ships WAL journal mode in the template", () => {
    const file = db.url.replace(/^file:/, "");
    const direct = new Database(file, { readonly: true });
    const row = direct.pragma("journal_mode", { simple: true }) as string;
    direct.close();
    expect(row.toLowerCase()).toBe("wal");
  });

  it("applies busy_timeout on a directly-opened handle", () => {
    const file = db.url.replace(/^file:/, "");
    const direct = new Database(file);
    direct.pragma("busy_timeout = 5000");
    expect(direct.pragma("busy_timeout", { simple: true })).toBe(5000);
    direct.close();
  });
});
