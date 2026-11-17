import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import Dexie from "dexie";
import { LocalLibraryDatabase } from "./db";

/**
 * Regression test for the "Upgrade error not yet supported for changing
 * primary key" failure that made every v1–v3 device's local database refuse to
 * open — and with it, all covers (they live in the same database).
 *
 * The device would otherwise never recover: the open threw before any app code
 * ran, so the failure looked like "the app is fine, just shows placeholders".
 */
describe("v3 -> current schema upgrade (the Dexie primary-key fix)", () => {
  it("opens without error, drops the legacy replica rows, and keeps covers", async () => {
    const name = `test-v3-upgrade-${crypto.randomUUID()}`;

    // Build a v3-shaped database, exactly as the shipped code did.
    const v3 = new Dexie(name);
    v3.version(3).stores({
      books: "id",
      covers: "&key",
      keyEnvelopes: "&profileId",
      privateRows: "&id, [profileId+table]",
    });
    await v3.open();
    await v3.table("books").put({
      id: 1,
      book: { id: 1, title: "Legacy replica", author: "A", duration: 10, fileFormat: "mp3", createdAt: "2026-01-01", tracks: [] },
      fetchedAt: "2026-01-01",
      tracks: {},
    });
    await v3.table("covers").put({ key: "book:1", blob: new Blob(["x"]), etag: null, savedAt: 1, bytes: 1 });
    v3.close();

    // Opening with the current schema must not throw.
    const current = new LocalLibraryDatabase(name);
    const books = await current.books.toArray();
    expect(books).toEqual([]); // legacy rows were disposable; deliberately dropped
    const covers = await current.covers.toArray();
    expect(covers).toHaveLength(1); // cached artwork survives
    expect(await current.privateRows.toArray()).toEqual([]);
    await current.delete();
  });

  it("opens a fresh database with the current schema (no v3 data anywhere)", async () => {
    const name = `test-fresh-${crypto.randomUUID()}`;
    const db = new LocalLibraryDatabase(name);
    await db.open();
    await db.delete();
  });
});
