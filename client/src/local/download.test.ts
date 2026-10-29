import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Audiobook } from "../types";
import { LocalLibraryDatabase } from "./db";
import { downloadBook, type DownloadProgress } from "./download";
import { downloadedTracks, isFullyDownloaded, type FileSystemPort } from "./replica";

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

/** Filesystem fake whose `download` can be told to fail or report sizes. */
function fakeFiles(options: { bytes?: number; failOn?: Set<string>; reportBytes?: boolean; expectedBytes?: number } = {}) {
  const written = new Map<string, number>();
  const failOn = options.failOn ?? new Set<string>();
  const reportBytes = options.reportBytes ?? true;

  const files: FileSystemPort = {
    download: vi.fn(async ({ path }: { path: string }) => {
      if (failOn.has(path)) throw new Error("network died");
      const bytes = options.bytes ?? 2048;
      written.set(path, bytes);
      // Default to agreeing with what was written, so the completeness check
      // only fails when a test explicitly asks it to.
      return { path, bytes: reportBytes ? bytes : 0, expectedBytes: options.expectedBytes ?? bytes };
    }),
    remove: vi.fn(async (path: string) => {
      written.delete(path);
    }),
    stat: vi.fn(async (path: string) => written.get(path) ?? 0),
    listDir: vi.fn(async () => [] as string[]),
    playableUrl: vi.fn(async (path: string) => `capacitor-file://${path}`),
  };
  return { files, written };
}

let db: LocalLibraryDatabase;
let counter = 0;

beforeEach(() => {
  db = new LocalLibraryDatabase(`download-test-${counter++}`);
});

afterEach(() => {
  db.close();
});

describe("downloadBook", () => {
  it("downloads every track and marks the book fully downloaded", async () => {
    const { files } = fakeFiles();
    await downloadBook(book(), { db, files, trackUrl: (id) => `/api/tracks/${id}/stream` });

    const row = await db.books.get(7);
    expect(isFullyDownloaded(row)).toBe(true);
    expect(downloadedTracks(row).map((t) => t.trackId)).toEqual([70, 71]);
  });

  it("writes each track to a path derived from book and track id", async () => {
    const { files, written } = fakeFiles();
    await downloadBook(book(), { db, files, trackUrl: (id) => `url/${id}` });
    expect([...written.keys()]).toEqual(["books/7/70.mp3", "books/7/71.mp3"]);
  });

  it("records the byte size so the storage screen is accurate", async () => {
    const { files } = fakeFiles({ bytes: 4096 });
    await downloadBook(book(), { db, files, trackUrl: (id) => `url/${id}` });
    const row = await db.books.get(7);
    expect(downloadedTracks(row).map((t) => t.bytes)).toEqual([4096, 4096]);
  });

  it("falls back to stat when the plugin reports no size", async () => {
    // Otherwise a book silently under-reports its footprint on the storage
    // screen, which is the one place the user checks before deleting things.
    const { files } = fakeFiles({ bytes: 1500, reportBytes: false });
    await downloadBook(book(), { db, files, trackUrl: (id) => `url/${id}` });
    const row = await db.books.get(7);
    expect(downloadedTracks(row).map((t) => t.bytes)).toEqual([1500, 1500]);
  });

  it("uses the book's file format for the extension", async () => {
    const { files, written } = fakeFiles();
    await downloadBook(book({ fileFormat: "m4b" }), { db, files, trackUrl: (id) => `url/${id}` });
    expect([...written.keys()]).toEqual(["books/7/70.m4b", "books/7/71.m4b"]);
  });

  it("stores the metadata before any audio, so partial progress is recordable", async () => {
    // Tracks are recorded against the replica row as they land; if metadata
    // were written last, a failure would leave audio on disk that the app has
    // no record of.
    const { files } = fakeFiles({ failOn: new Set(["books/7/71.mp3"]) });
    await expect(
      downloadBook(book(), { db, files, trackUrl: (id) => `url/${id}` }),
    ).rejects.toThrow("network died");

    const row = await db.books.get(7);
    expect(row?.book.title).toBe("The Left Hand of Darkness");
  });

  it("keeps the tracks that arrived before a failure", async () => {
    const { files } = fakeFiles({ failOn: new Set(["books/7/71.mp3"]) });
    await expect(
      downloadBook(book(), { db, files, trackUrl: (id) => `url/${id}` }),
    ).rejects.toThrow("network died");

    const row = await db.books.get(7);
    expect(downloadedTracks(row).map((t) => t.trackId)).toEqual([70]);
    expect(isFullyDownloaded(row)).toBe(false);
  });

  it("stops at the first failure rather than hammering the network", async () => {
    const { files } = fakeFiles({ failOn: new Set(["books/7/70.mp3"]) });
    await expect(
      downloadBook(book(), { db, files, trackUrl: (id) => `url/${id}` }),
    ).rejects.toThrow("network died");
    expect(files.download).toHaveBeenCalledTimes(1);
  });

  it("passes auth headers through to the native download", async () => {
    // Without them every track request would 401 on a password-protected
    // server and the download would fail on the first file.
    const { files } = fakeFiles();
    await downloadBook(book(), {
      db,
      files,
      trackUrl: (id) => `url/${id}`,
      headers: { "x-profile-id": "3" },
    });
    expect(vi.mocked(files.download).mock.calls[0][0].headers).toEqual({ "x-profile-id": "3" });
  });

  it("refuses a book with no tracks rather than recording a false success", async () => {
    const { files } = fakeFiles();
    await expect(
      downloadBook(book({ tracks: [] }), { db, files, trackUrl: (id) => `url/${id}` }),
    ).rejects.toThrow(/no tracks/i);
    expect(await db.books.get(7)).toBeUndefined();
  });

  it("stamps tracks with the injected clock", async () => {
    const { files } = fakeFiles();
    await downloadBook(book(), {
      db,
      files,
      trackUrl: (id) => `url/${id}`,
      now: () => new Date("2026-10-13T12:00:00.000Z"),
    });
    const row = await db.books.get(7);
    expect(downloadedTracks(row)[0].downloadedAt).toBe("2026-10-13T12:00:00.000Z");
  });
});

describe("download progress", () => {
  it("reports completion once per track", async () => {
    const { files } = fakeFiles();
    const seen: DownloadProgress[] = [];
    await downloadBook(book(), { db, files, trackUrl: (id) => `url/${id}` }, (p) => seen.push(p));

    expect(seen.filter((p) => p.trackFraction === 1)).toHaveLength(2);
    expect(seen[seen.length - 1]).toMatchObject({ completed: 2, total: 2, fraction: 1 });
  });

  it("never reports a fraction outside 0..1", async () => {
    // A plugin reporting 1.4 would otherwise drive the bar past its end.
    const { files } = fakeFiles();
    const seen: number[] = [];
    const wrapped: FileSystemPort = {
      ...files,
      download: async (options) => {
        const result = await files.download(options);
        options.onProgress?.(1.4);
        return result;
      },
    };
    await downloadBook(book(), { db, files: wrapped, trackUrl: (id) => `url/${id}` }, (p) =>
      seen.push(p.fraction),
    );
    expect(seen.every((f) => f >= 0 && f <= 1)).toBe(true);
  });

  it("treats a non-finite fraction as zero rather than NaN", async () => {
    const { files } = fakeFiles();
    const seen: number[] = [];
    const wrapped: FileSystemPort = {
      ...files,
      download: async (options) => {
        const result = await files.download(options);
        options.onProgress?.(Number.NaN);
        return result;
      },
    };
    await downloadBook(book(), { db, files: wrapped, trackUrl: (id) => `url/${id}` }, (p) =>
      seen.push(p.fraction),
    );
    expect(seen.some(Number.isNaN)).toBe(false);
  });
});
