import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Audiobook } from "../types";
import { LocalLibraryDatabase } from "./db";
import {
  findUnclaimedBookIds,
  listUnclaimedOnDevice,
  matchTrackFiles,
  parseBookDirectory,
  parseTrackFile,
  recoverBooks,
} from "./recover";
import { downloadedTracks, isFullyDownloaded, trackPath, replicaBookKey, type FileSystemPort } from "./replica";

/**
 * Spec 29, phase 5 -- recovering audio that outlived its database row.
 *
 * The real case: the WebView origin changed, so IndexedDB began empty while
 * `books/<id>/<trackId>.<ext>` was still on the phone. These tests use a
 * two-track book and assert the three things that matter: real tracks are
 * adopted, unknown files are ignored, and a folder the server does not know is
 * left exactly where it is.
 */

function book(overrides: Partial<Audiobook> = {}): Audiobook {
  return {
    id: 7,
    title: "The Left Hand of Darkness",
    author: "Ursula K. Le Guin",
    duration: 900,
    fileFormat: "mp3",
    createdAt: "2026-01-01T00:00:00.000Z",
    tracks: [
      { id: 70, title: "Part 1", duration: 300, trackNumber: 1 },
      { id: 71, title: "Part 2", duration: 300, trackNumber: 2 },
    ],
    ...overrides,
  };
}

function fakeFiles(directories: Record<string, string[]>) {
  const removed: string[] = [];
  const files: FileSystemPort = {
    download: vi.fn(async () => ({ path: "x", bytes: 1, expectedBytes: 1 })),
    remove: vi.fn(async (path: string) => {
      removed.push(path);
    }),
    stat: vi.fn(async () => 4096),
    listDir: vi.fn(async (path: string) => {
      const names = directories[path];
      if (!names) throw new Error(`OS-PLUG-FILE-0008: ${path} does not exist`);
      return names;
    }),
    playableUrl: vi.fn(async (path: string) => `capacitor-file://${path}`),
  };
  return { files, removed };
}

/** Local composite key (`<serverId>#<bookId>`) for the default-server shelf. */
const key = (bookId: number) => replicaBookKey("", bookId);

let db: LocalLibraryDatabase;
let counter = 0;

beforeEach(() => {
  db = new LocalLibraryDatabase(`recover-test-${counter++}`);
});

afterEach(() => {
  db.close();
});

describe("parseBookDirectory", () => {
  it("accepts plain positive ids", () => {
    expect(parseBookDirectory("7")).toBe(7);
    expect(parseBookDirectory("1234")).toBe(1234);
  });

  it("refuses anything that is not plainly a book id", () => {
    for (const name of ["", "007", "0", "-3", "1.5", "book", ".nomedia", "7 copies", "9007199254740993"]) {
      expect(parseBookDirectory(name)).toBeNull();
    }
  });
});

describe("findUnclaimedBookIds", () => {
  it("returns only numeric folders the replica does not know", () => {
    expect(findUnclaimedBookIds(["7", "8", "notes", ".nomedia", "12"], [7, 12])).toEqual([8]);
  });

  it("sorts and de-duplicates", () => {
    expect(findUnclaimedBookIds(["9", "7", "9"], [])).toEqual([7, 9]);
  });

  it("is empty when every folder is claimed", () => {
    expect(findUnclaimedBookIds(["1", "2"], [1, 2])).toEqual([]);
  });
});

describe("parseTrackFile", () => {
  it("reads the shape a download writes", () => {
    expect(parseTrackFile("70.mp3")).toEqual({ trackId: 70, extension: "mp3" });
    expect(parseTrackFile("71.M4B")).toEqual({ trackId: 71, extension: "m4b" });
  });

  it("ignores everything else", () => {
    for (const name of ["70", "70.", ".mp3", "070.mp3", "part 1.mp3", "70.mp3.tmp", "70.toolongext"]) {
      expect(parseTrackFile(name)).toBeNull();
    }
  });
});

describe("matchTrackFiles", () => {
  it("keeps only files that belong to the book's own tracks", () => {
    expect(matchTrackFiles(book(), ["70.mp3", "71.mp3", "999.mp3", "notes.txt", "70.tmp"])).toEqual([
      { trackId: 70, extension: "mp3" },
      { trackId: 71, extension: "mp3" },
    ]);
  });

  it("does not adopt the same track twice", () => {
    expect(matchTrackFiles(book(), ["70.mp3", "70.m4b"])).toEqual([
      { trackId: 70, extension: "mp3" },
    ]);
  });
});

describe("listUnclaimedOnDevice", () => {
  it("treats an unreadable directory as nothing found rather than an error", async () => {
    const { files } = fakeFiles({});
    await expect(listUnclaimedOnDevice(files, [])).resolves.toEqual([]);
  });

  it("finds the folders that outlived their rows", async () => {
    const { files } = fakeFiles({ books: ["7", "8", "notes"] });
    await expect(listUnclaimedOnDevice(files, [7])).resolves.toEqual([8]);
  });
});

describe("recoverBooks", () => {
  it("rebuilds a two-track book from the files on disk", async () => {
    const { files } = fakeFiles({ "books/7": ["70.mp3", "71.mp3"] });
    const result = await recoverBooks([7], {
      db,
      files,
      fetchBook: async () => book(),
      now: () => new Date("2026-03-01T00:00:00.000Z"),
    });

    expect(result.recovered).toEqual([
      { bookId: 7, title: "The Left Hand of Darkness", tracks: 2 },
    ]);
    const row = await db.books.get(key(7));
    expect(isFullyDownloaded(row)).toBe(true);
    expect(downloadedTracks(row).map((track) => track.path)).toEqual([
      trackPath(7, 70, "mp3"),
      trackPath(7, 71, "mp3"),
    ]);
    expect(downloadedTracks(row)[0].bytes).toBe(4096);
  });

  it("adopts the real tracks and ignores an unmatched file", async () => {
    const { files } = fakeFiles({ "books/7": ["70.mp3", "not-a-track.mp3"] });
    const result = await recoverBooks([7], { db, files, fetchBook: async () => book() });

    expect(result.recovered[0].tracks).toBe(1);
    const row = await db.books.get(key(7));
    expect(downloadedTracks(row).map((track) => track.trackId)).toEqual([70]);
    // A partial book must not claim to be complete: playback would stop halfway.
    expect(isFullyDownloaded(row)).toBe(false);
  });

  it("leaves a folder the server does not know completely untouched", async () => {
    const { files, removed } = fakeFiles({ "books/7": ["70.mp3"] });
    const result = await recoverBooks([7], { db, files, fetchBook: async () => "missing" });

    expect(result.missing).toEqual([7]);
    expect(await db.books.get(key(7))).toBeUndefined();
    expect(files.remove).not.toHaveBeenCalled();
    expect(removed).toEqual([]);
  });

  it("reports a folder with no recognisable files instead of inventing a book", async () => {
    const { files } = fakeFiles({ "books/7": ["readme.txt", "70.mp3.tmp"] });
    const result = await recoverBooks([7], { db, files, fetchBook: async () => book() });

    expect(result.unmatched).toEqual([7]);
    expect(await db.books.get(key(7))).toBeUndefined();
  });

  it("does not mistake an unreachable server for a deleted book", async () => {
    const { files, removed } = fakeFiles({ "books/7": ["70.mp3"] });
    const result = await recoverBooks([7], {
      db,
      files,
      fetchBook: async () => {
        throw new Error("cannot reach the server");
      },
    });

    expect(result.unreadable).toEqual([7]);
    expect(result.missing).toEqual([]);
    expect(removed).toEqual([]);
    expect(await db.books.get(key(7))).toBeUndefined();
  });

  it("is idempotent: running it twice does not duplicate or lose tracks", async () => {
    const { files } = fakeFiles({ "books/7": ["70.mp3", "71.mp3"] });
    const deps = { db, files, fetchBook: async () => book() as Audiobook | "missing" };
    await recoverBooks([7], deps);
    await recoverBooks([7], deps);

    const rows = await db.books.toArray();
    expect(rows).toHaveLength(1);
    expect(downloadedTracks(rows[0])).toHaveLength(2);
  });
});
