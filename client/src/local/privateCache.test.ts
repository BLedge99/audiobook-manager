import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalLibraryDatabase } from "./db";
import {
  activeCacheProfileId,
  cacheFavourites,
  cacheProgress,
  deleteProfileCache,
  exportActiveProfileKey,
  getPrivateValue,
  hasProfileCache,
  lockOfflineCache,
  offlineCacheState,
  putPrivateValue,
  readFavourites,
  readProgress,
  rememberProfileKey,
  rewrapProfileKey,
  unlockProfileCache,
  unlockProfileCacheWithKey,
  WrongPasswordError,
} from "./privateCache";

let db: LocalLibraryDatabase;
let counter = 0;

beforeEach(() => {
  lockOfflineCache();
  db = new LocalLibraryDatabase(`cache-test-${counter++}`);
});

afterEach(async () => {
  lockOfflineCache();
  db.close();
});

describe("the offline cache envelope", () => {
  it("counts a fingerprint Vault key as a cache as well as a password envelope", () => {
    // Spec 29 / ADR 018. A device signed in with a fingerprint stores the DEK
    // in the native Vault and never writes an envelope, so checking only the
    // envelope told that listener their downloads had no protected data.
    expect(offlineCacheState(true, false)).toBe("present");
    expect(offlineCacheState(false, true)).toBe("present");
    expect(offlineCacheState(true, true)).toBe("present");
    expect(offlineCacheState(false, false)).toBe("absent");
  });

  it("restores the same profile key released by the Android Vault", async () => {
    await rememberProfileKey(7, "correct-horse-9", db);
    await putPrivateValue("progress", "42", { position: 1234 }, db);
    const nativeVaultKey = await exportActiveProfileKey(7);
    expect(nativeVaultKey).toHaveLength(32);

    lockOfflineCache();
    await unlockProfileCacheWithKey(7, nativeVaultKey!);

    expect(activeCacheProfileId()).toBe(7);
    expect(await getPrivateValue("progress", "42", db)).toEqual({ position: 1234 });
  });

  it("stores only a wrapped key and encrypts private values", async () => {
    await rememberProfileKey(7, "correct-horse-9", db);
    expect(activeCacheProfileId()).toBe(7);

    await putPrivateValue("progress", "42", { position: 1234 }, db);

    const envelope = await db.keyEnvelopes.get(7);
    expect(envelope?.wrappedKey).toBeTruthy();
    expect(JSON.stringify(envelope)).not.toContain("correct-horse-9");

    const row = await db.privateRows.get("7:progress:42");
    expect(row).toBeDefined();
    expect(JSON.stringify(row)).not.toContain("1234");

    expect(await getPrivateValue("progress", "42", db)).toEqual({ position: 1234 });
  });

  it("fails a wrong password without deleting anything", async () => {
    await rememberProfileKey(7, "correct-horse-9", db);
    await cacheFavourites([1, 2, 3], "https://a.example", db);

    lockOfflineCache();
    await expect(unlockProfileCache(7, "wrong-password", db)).rejects.toBeInstanceOf(
      WrongPasswordError,
    );

    expect(await hasProfileCache(7, db)).toBe(true);
    // The correct password still opens the same data: a failed attempt is not
    // a destructive one.
    await unlockProfileCache(7, "correct-horse-9", db);
    expect(await readFavourites("https://a.example", db)).toEqual([1, 2, 3]);
  });

  it("rewraps the key without re-encrypting rows", async () => {
    await rememberProfileKey(7, "correct-horse-9", db);
    await putPrivateValue("wishlist", "items", [{ title: "Earthsea" }], db);
    const before = await db.privateRows.get("7:wishlist:items");

    expect(await rewrapProfileKey(7, "correct-horse-9", "new-password-9", db)).toBe(true);
    expect(await db.privateRows.get("7:wishlist:items")).toEqual(before);

    lockOfflineCache();
    await expect(unlockProfileCache(7, "correct-horse-9", db)).rejects.toBeInstanceOf(
      WrongPasswordError,
    );
    await unlockProfileCache(7, "new-password-9", db);
    expect(await getPrivateValue("wishlist", "items", db)).toEqual([{ title: "Earthsea" }]);
  });

  it("deletes one profile's cache and leaves another profile alone", async () => {
    await rememberProfileKey(7, "correct-horse-9", db);
    await putPrivateValue("progress", "1", { position: 1 }, db);
    await rememberProfileKey(8, "other-password-9", db);
    await putPrivateValue("progress", "2", { position: 2 }, db);

    await deleteProfileCache(7, db);

    expect(await hasProfileCache(7, db)).toBe(false);
    expect(await db.privateRows.get("7:progress:1")).toBeUndefined();
    expect(await db.privateRows.get("8:progress:2")).toBeDefined();
  });

  it("does not invent a cache when offline has no envelope", async () => {
    lockOfflineCache();
    await expect(unlockProfileCache(99, "anything", db)).rejects.toHaveProperty(
      "name",
      "CacheKeyMissingError",
    );
    expect(await hasProfileCache(99, db)).toBe(false);
  });
});

describe("the private cache is scoped to a server", () => {
  /**
   * The device library is a union of per-server shelves (spec 30), so a
   * phone pointed at two servers holds two different books that both happen to
   * be number 7.
   *
   * The replica rows are keyed `<serverId>#<bookId>`. The **private** rows
   * were keyed by the bare book id, so the second server's book 7 overwrote
   * the first server's resume position -- and the encrypted row the listener
   * last saved was the one that disappeared.
   */
  it("keeps two servers' progress for the same book id apart", async () => {
    await rememberProfileKey(7, "correct-horse-9", db);

    await cacheProgress(
      7,
      { position: 100, completed: false, lastPlayed: "2026-11-11T00:00:00.000Z" },
      "https://a.example",
      db,
    );
    await cacheProgress(
      7,
      { position: 900, completed: false, lastPlayed: "2026-11-11T00:00:00.000Z" },
      "https://b.example",
      db,
    );

    expect((await readProgress(7, "https://a.example", db))?.position).toBe(100);
    expect((await readProgress(7, "https://b.example", db))?.position).toBe(900);
  });

  it("keeps two servers' favourites apart", async () => {
    // A favourite id means a book on a particular server's catalogue. On
    // another server the same id is a different book.
    await rememberProfileKey(7, "correct-horse-9", db);

    await cacheFavourites([1, 2, 3], "https://a.example", db);
    await cacheFavourites([4, 5], "https://b.example", db);

    expect(await readFavourites("https://a.example", db)).toEqual([1, 2, 3]);
    expect(await readFavourites("https://b.example", db)).toEqual([4, 5]);
  });

  it("still finds a position written before the server scope existed", async () => {
    // An upgrade must not lose a listener's place. The old rows are keyed by
    // the bare book id, so the read falls back to them.
    await rememberProfileKey(7, "correct-horse-9", db);
    await putPrivateValue(
      "progress",
      "42",
      { position: 1234, completed: false, lastPlayed: "2026-11-11T00:00:00.000Z" },
      db,
    );

    expect((await readProgress(42, "https://a.example", db))?.position).toBe(1234);
  });
});
