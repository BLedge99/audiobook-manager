import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Dexie from "dexie";
import { LocalLibraryDatabase } from "./db";
import {
  addExternalItem,
  listExternalItems,
  removeExternalItem,
} from "./externalItems";

/** Unique DB per test so parallel tests cannot leak rows into each other. */
function freshDb() {
  return new LocalLibraryDatabase(`test-external-${crypto.randomUUID()}`);
}

const AUDIBLE_URL = "https://www.audible.com/pd/The-Count-of-Monte-Cristo/B00S2LTCQK";
const LIBROFM_URL = "https://libro.fm/audiobooks/9781705085059-fourth-wing";

describe("addExternalItem", () => {
  let db: LocalLibraryDatabase;

  beforeEach(() => {
    db = freshDb();
  });

  afterEach(async () => {
    await db.delete();
  });

  it("stores an item parsed from the URL and lists it", async () => {
    const result = await addExternalItem(db, AUDIBLE_URL);
    expect(result).toMatchObject({
      ok: true,
      created: true,
      item: expect.objectContaining({
        store: "audible",
        externalId: "B00S2LTCQK",
        httpsUrl: "https://www.audible.com/pd/The-Count-of-Monte-Cristo/B00S2LTCQK",
        title: "the count of monte cristo",
      }),
    });

    const listed = await listExternalItems(db);
    expect(listed).toHaveLength(1);
    expect(listed[0].store).toBe("audible");
  });

  it("honours caller-provided title and author over the URL hint", async () => {
    const result = await addExternalItem(db, LIBROFM_URL, {
      title: "Fourth Wing",
      author: "Rebecca Yarros",
    });
    expect(result).toMatchObject({ ok: true, item: expect.objectContaining({ title: "Fourth Wing", author: "Rebecca Yarros" }) });
  });

  it("adding the same URL twice dedupes on store + externalId", async () => {
    const first = await addExternalItem(db, AUDIBLE_URL);
    const second = await addExternalItem(db, AUDIBLE_URL);
    expect(first).toMatchObject({ ok: true, created: true });
    expect(second).toMatchObject({ ok: true, created: false });
    expect(await listExternalItems(db)).toHaveLength(1);
  });

  it("dedupes independently across stores for the same ASIN-length string", async () => {
    await addExternalItem(db, AUDIBLE_URL);
    const librofm = await addExternalItem(db, LIBROFM_URL);
    expect(librofm).toMatchObject({ ok: true, created: true });
  });

  it("rejects an unparseable URL and stores nothing", async () => {
    const result = await addExternalItem(db, "https://example.com/not-a-store");
    expect(result).toEqual({ ok: false, code: "unsupported-host" });
    expect(await listExternalItems(db)).toHaveLength(0);
  });

  it("removeExternalItem deletes only the target row", async () => {
    const a = await addExternalItem(db, AUDIBLE_URL);
    const b = await addExternalItem(db, LIBROFM_URL);
    if (!a.ok || !b.ok) throw new Error("setup failed");
    await removeExternalItem(db, a.item.id);
    const remaining = await listExternalItems(db);
    expect(remaining.map((item) => item.store)).toEqual(["librofm"]);
  });
});

describe("database upgrade (v4 → v5)", () => {
  it("keeps existing replica books and covers intact", async () => {
    const name = `test-upgrade-${crypto.randomUUID()}`;

    // Build a v4-shaped database exactly as the shipped code did.
    const v4 = new Dexie(name);
    v4.version(4).stores({
      books: "bookKey",
      covers: "&key",
      keyEnvelopes: "&profileId",
      privateRows: "&id, [profileId+table]",
    });
    await v4.open();
    await v4.table("books").put({
      bookKey: "https://server#1",
      serverId: "https://server",
      book: { id: 1, title: "Kept", author: "A", duration: 10, fileFormat: "mp3", createdAt: "2026-01-01", tracks: [] },
      fetchedAt: "2026-01-01",
      tracks: {},
    });
    await v4.table("covers").put({ key: "book:1", blob: new Blob(["x"]), etag: null, savedAt: 1, bytes: 1 });
    v4.close();

    // Open with the current (v5) schema and assert nothing was lost.
    const current = new LocalLibraryDatabase(name);
    const books = await current.books.toArray();
    expect(books).toHaveLength(1);
    expect(books[0].book.title).toBe("Kept");
    expect(await current.covers.toArray()).toHaveLength(1);
    expect(await current.externalItems.toArray()).toEqual([]);
    await current.delete();
  });
});
