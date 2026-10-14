import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Audiobook } from "../types";
import { LocalLibraryDatabase } from "./db";
import {
  bookBytes,
  countReplicaBooks,
  downloadedTracks,
  extensionFor,
  isFullyDownloaded,
  listReplicaAudiobooks,
  putDownloadedTrack,
  putReplicaBook,
  removeDownloadedBook,
  totalReplicaBytes,
  trackPath,
  type FileSystemPort,
} from "./replica";

function book(overrides: Partial<Audiobook> = {}): Audiobook {
  return {
    id: 1,
    title: "A Wizard of Earthsea",
    author: "Ursula K. Le Guin",
    duration: 600,
    fileFormat: "mp3",
    createdAt: "2026-01-01T00:00:00.000Z",
    tracks: [
      { id: 10, title: "Chapter 1", duration: 300, trackNumber: 1 },
      { id: 11, title: "Chapter 2", duration: 300, trackNumber: 2 },
    ],
    ...overrides,
  };
}

function track(trackId: number, bytes = 1024, bookId = 1) {
  return { trackId, path: trackPath(bookId, trackId), bytes, downloadedAt: "2026-01-01T00:00:00.000Z" };
}

/** In-memory filesystem. Records what was deleted so order can be asserted. */
function fakeFiles(onRemove?: (path: string) => void | Promise<void>) {
  const removed: string[] = [];
  const failOn = new Set<string>();
  const files: FileSystemPort = {
    download: vi.fn(async () => ({ path: "x", bytes: 1, expectedBytes: 1 })),
    remove: vi.fn(async (path: string) => {
      if (failOn.has(path)) throw new Error("locked");
      removed.push(path);
      await onRemove?.(path);
    }),
    stat: vi.fn(async () => 0),
    playableUrl: vi.fn(async (path: string) => `capacitor-file://${path}`),
  };
  return { files, removed, failOn };
}

let db: LocalLibraryDatabase;
let counter = 0;

beforeEach(() => {
  // A unique name per test: jsdom keeps one IndexedDB origin for the whole file,
  // so a shared name leaks rows between tests and makes them order-dependent.
  db = new LocalLibraryDatabase(`replica-test-${counter++}`);
});

afterEach(async () => {
  db.close();
});

describe("trackPath", () => {
  it("nests by book then track, with no leading slash", () => {
    // Capacitor treats a leading slash in `path` as absolute-from-root, which
    // would write outside the app's data directory.
    expect(trackPath(42, 7)).toBe("books/42/7.mp3");
  });

  it("does not double the dot when the format already has one", () => {
    expect(trackPath(1, 1, ".m4b")).toBe("books/1/1.m4b");
  });
});

describe("extensionFor", () => {
  it("passes through a normal format", () => {
    expect(extensionFor("mp3")).toBe("mp3");
    expect(extensionFor("M4B")).toBe("m4b");
    expect(extensionFor(".ogg")).toBe("ogg");
  });

  it("falls back to mp3 for missing or unsafe values", () => {
    expect(extensionFor(undefined)).toBe("mp3");
    expect(extensionFor("")).toBe("mp3");
    // A traversal attempt must never reach the filesystem.
    expect(extensionFor("../../etc/passwd")).toBe("mp3");
    expect(extensionFor("a/b")).toBe("mp3");
    expect(extensionFor("toolongext")).toBe("mp3");
  });
});

describe("replica storage", () => {
  it("stores and reads back a book", async () => {
    await putReplicaBook(db, book());
    expect(await countReplicaBooks(db)).toBe(1);
    const [read] = await listReplicaAudiobooks(db);
    expect(read.title).toBe("A Wizard of Earthsea");
  });

  it("refreshes metadata without dropping downloaded tracks", async () => {
    // Re-downloading or refreshing metadata must never silently un-download a
    // book the user already has on the device.
    await putReplicaBook(db, book());
    await putDownloadedTrack(db, 1, track(10));
    await putReplicaBook(db, book({ title: "Earthsea (retitled)" }));

    const row = await db.books.get(1);
    expect(row?.book.title).toBe("Earthsea (retitled)");
    expect(row?.tracks[10]).toBeDefined();
  });

  it("merges newly downloaded tracks", async () => {
    await putReplicaBook(db, book());
    await putDownloadedTrack(db, 1, track(10));
    await putDownloadedTrack(db, 1, track(11, 2048));

    const row = await db.books.get(1);
    expect(Object.keys(row!.tracks)).toHaveLength(2);
    expect(bookBytes(row)).toBe(3072);
  });

  it("refuses to record a track for a book with no replica entry", async () => {
    // Without a book row there is no metadata to read offline, so a track alone
    // would be audio the user cannot reach.
    await expect(putDownloadedTrack(db, 999, track(10))).rejects.toThrow(/No replica entry/);
  });
});

describe("isFullyDownloaded", () => {
  it("is false when nothing is downloaded", async () => {
    await putReplicaBook(db, book());
    expect(isFullyDownloaded(await db.books.get(1))).toBe(false);
  });

  it("is false for a partial download", async () => {
    // A half-downloaded book that claims to be available runs out mid-chapter,
    // which is worse than it being plainly unavailable.
    await putReplicaBook(db, book());
    await putDownloadedTrack(db, 1, track(10));
    expect(isFullyDownloaded(await db.books.get(1))).toBe(false);
  });

  it("is true once every track is present", async () => {
    await putReplicaBook(db, book());
    await putDownloadedTrack(db, 1, track(10));
    await putDownloadedTrack(db, 1, track(11));
    expect(isFullyDownloaded(await db.books.get(1))).toBe(true);
  });

  it("is false for an unknown book", () => {
    expect(isFullyDownloaded(undefined)).toBe(false);
  });

  it("is false for a book the server reports no tracks for", async () => {
    // Otherwise a zero-track book would look downloaded with nothing to play.
    await putReplicaBook(db, book({ tracks: [] }));
    expect(isFullyDownloaded(await db.books.get(1))).toBe(false);
  });
});

describe("downloadedTracks", () => {
  it("returns them in server order, not download order", async () => {
    await putReplicaBook(db, book());
    // Downloaded back to front.
    await putDownloadedTrack(db, 1, track(11));
    await putDownloadedTrack(db, 1, track(10));

    expect(downloadedTracks(await db.books.get(1)).map((t) => t.trackId)).toEqual([10, 11]);
  });

  it("is empty for an unknown book", () => {
    expect(downloadedTracks(undefined)).toEqual([]);
  });
});

describe("totalReplicaBytes", () => {
  it("sums every downloaded book", async () => {
    await putReplicaBook(db, book());
    await putDownloadedTrack(db, 1, track(10, 100));
    await putDownloadedTrack(db, 1, track(11, 250));

    // A second book with its own track ids: `downloadedTracks` walks the
    // server's track list, so a track id the book does not declare is ignored.
    await putReplicaBook(
      db,
      book({ id: 2, title: "Other", tracks: [{ id: 20, duration: 100, trackNumber: 1 }] }),
    );
    await putDownloadedTrack(db, 2, track(20, 50, 2));

    expect(await totalReplicaBytes(db)).toBe(400);
  });

  it("is zero for an empty replica", async () => {
    expect(await totalReplicaBytes(db)).toBe(0);
  });
});

describe("removeDownloadedBook", () => {
  it("deletes the files and the record", async () => {
    await putReplicaBook(db, book());
    await putDownloadedTrack(db, 1, track(10));
    await putDownloadedTrack(db, 1, track(11));
    const { files, removed } = fakeFiles();

    const result = await removeDownloadedBook(db, files, 1);

    expect(result).toEqual({ removed: true, failed: [] });
    expect(removed).toEqual(["books/1/10.mp3", "books/1/11.mp3"]);
    expect(await db.books.get(1)).toBeUndefined();
  });

  it("deletes files before forgetting the record", async () => {
    // Reversed, a failure would leave orphaned gigabytes of audio that nothing
    // else tracks, with no way for the user to reclaim the space. Asserted by
    // checking the row still exists at the moment each file is deleted, rather
    // than by mocking Dexie's internals.
    await putReplicaBook(db, book());
    await putDownloadedTrack(db, 1, track(10));
    await putDownloadedTrack(db, 1, track(11));

    const rowPresentDuringDelete: boolean[] = [];
    const { files } = fakeFiles(async () => {
      rowPresentDuringDelete.push((await db.books.get(1)) !== undefined);
    });

    await removeDownloadedBook(db, files, 1);

    expect(rowPresentDuringDelete).toEqual([true, true]);
    expect(await db.books.get(1)).toBeUndefined();
  });

  it("still forgets the book when one file cannot be deleted", async () => {
    // Otherwise a single locked file makes the book impossible to remove and
    // the user can never reclaim the space.
    await putReplicaBook(db, book());
    await putDownloadedTrack(db, 1, track(10));
    await putDownloadedTrack(db, 1, track(11));
    const { files, failOn } = fakeFiles();
    failOn.add("books/1/10.mp3");

    const result = await removeDownloadedBook(db, files, 1);

    expect(result.removed).toBe(true);
    expect(result.failed).toEqual(["books/1/10.mp3"]);
    expect(await db.books.get(1)).toBeUndefined();
  });

  it("is a no-op for a book that is not on the device", async () => {
    const { files } = fakeFiles();
    expect(await removeDownloadedBook(db, files, 404)).toEqual({ removed: false, failed: [] });
    expect(files.remove).not.toHaveBeenCalled();
  });
});
