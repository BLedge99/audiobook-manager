import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { Audiobook } from "../types";
import { LocalLibraryDatabase } from "./db";
import { useDeviceLibrary } from "./useDeviceLibrary";
import { putReplicaBook, trackPath, type FileSystemPort } from "./replica";
import type { DownloadedTrack } from "./db";

/**
 * The device library hook.
 *
 * It had no test file at all, and it wraps the whole offline experience:
 * refresh, isDownloaded, progressOf, download, remove, recover and
 * localUrlForTrack. Its collaborators -- `replica.ts` and `download.ts` -- are
 * well tested, so the hook is where the behaviour actually lives and where
 * nothing was checking it.
 *
 * The replica database and the filesystem are injected, so the hook can be
 * driven from a test with a real IndexedDB and an in-memory filesystem.
 */

const SERVER = "https://home.example";

function book(overrides: Partial<Audiobook> = {}): Audiobook {
  return {
    id: 1,
    title: "A Wizard of Earthsea",
    author: "Ursula K. Le Guin",
    duration: 600,
    fileFormat: "mp3",
    createdAt: "2026-01-01T00:00:00.000Z",
    tracks: [{ id: 10, title: "Chapter 1", duration: 300, trackNumber: 1 }],
    ...overrides,
  } as unknown as Audiobook;
}

/** In-memory filesystem. */
function fakeFiles(): FileSystemPort {
  return {
    download: vi.fn(async () => ({ path: "x", bytes: 1, expectedBytes: 1 })),
    remove: vi.fn(async () => {}),
    stat: vi.fn(async () => 0),
    listDir: vi.fn(async () => [] as string[]),
    playableUrl: vi.fn(async (path: string) => `capacitor-file://${path}`),
  };
}

let db: LocalLibraryDatabase;
let files: FileSystemPort;
let counter = 0;

beforeEach(() => {
  db = new LocalLibraryDatabase(`device-library-test-${counter++}`);
  files = fakeFiles();
});

afterEach(() => {
  db.close();
  vi.unstubAllGlobals();
});

/** Put a book on the device shelf, fully downloaded. */
async function downloaded(bookToStore: Audiobook, serverId = SERVER) {
  const tracks: Record<number, DownloadedTrack> = {};
  for (const track of bookToStore.tracks ?? []) {
    tracks[track.id] = {
      trackId: track.id,
      path: trackPath(bookToStore.id, track.id),
      bytes: 1024,
      downloadedAt: "2026-01-01T00:00:00.000Z",
    };
  }
  await putReplicaBook(db, bookToStore, tracks, serverId);
}

function mount(enabled = true) {
  return renderHook(() => useDeviceLibrary(enabled, { db, files }));
}

describe("useDeviceLibrary", () => {
  it("reads the device shelf on mount", async () => {
    await downloaded(book());

    const view = mount();

    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(view.result.current.books.map((entry) => entry.title)).toEqual(["A Wizard of Earthsea"]);
    expect(view.result.current.error).toBeNull();
  });

  it("reports a shelf that cannot be read, rather than an empty one", async () => {
    // A replica that will not open used to look exactly like a device with
    // nothing on it, and the app then told the listener "nothing has been
    // downloaded" while the audio sat on disk.
    const broken = {
      get: () => Promise.reject(new Error("QuotaExceededError")),
      where: () => broken,
      filter: () => broken,
      toArray: () => Promise.reject(new Error("QuotaExceededError")),
      put: () => Promise.reject(new Error("QuotaExceededError")),
    };
    const view = renderHook(() =>
      useDeviceLibrary(true, { db: broken as never, files }),
    );

    await waitFor(() => expect(view.result.current.error).toBeTruthy());
    expect(view.result.current.books).toEqual([]);
  });

  it("holds nothing when it is not enabled", async () => {
    await downloaded(book());

    const view = mount(false);

    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(view.result.current.books).toEqual([]);
  });

  it("says whether a book is downloaded, per shelf", async () => {
    await downloaded(book({ id: 1 }), SERVER);
    await downloaded(book({ id: 2, title: "The Tombs of Atuan" }), "https://other.example");

    const view = mount();
    await waitFor(() => expect(view.result.current.loading).toBe(false));

    expect(view.result.current.isDownloaded(1, SERVER)).toBe(true);
    expect(view.result.current.isDownloaded(2, SERVER)).toBe(false);
    expect(view.result.current.isDownloaded(2, "https://other.example")).toBe(true);
  });

  it("reports the fraction of a book that is downloaded", async () => {
    await downloaded(book());

    const view = mount();
    await waitFor(() => expect(view.result.current.loading).toBe(false));

    expect(view.result.current.progressOf(1, SERVER)).toBe(1);
    expect(view.result.current.progressOf(99, SERVER)).toBe(0);
  });

  it("reports how many bytes a book takes on the device", async () => {
    await downloaded(book());

    const view = mount();
    await waitFor(() => expect(view.result.current.loading).toBe(false));

    expect(view.result.current.bytesFor(1, SERVER)).toBe(1024);
    expect(view.result.current.usedBytes).toBe(1024);
  });

  it("gives a playable URL for a downloaded track", async () => {
    await downloaded(book());

    const view = mount();
    await waitFor(() => expect(view.result.current.loading).toBe(false));

    const url = await view.result.current.localUrlForTrack(1, 10, SERVER);
    expect(url).toContain("capacitor-file://");
  });

  it("gives no playable URL for a track that is not on the device", async () => {
    const view = mount();
    await waitFor(() => expect(view.result.current.loading).toBe(false));

    expect(await view.result.current.localUrlForTrack(1, 10, SERVER)).toBeUndefined();
  });

  it("removes a book from the device", async () => {
    await downloaded(book());

    const view = mount();
    await waitFor(() => expect(view.result.current.loading).toBe(false));

    await act(async () => {
      await view.result.current.remove(1, SERVER);
    });

    await waitFor(() => expect(view.result.current.books).toEqual([]));
    expect(files.remove).toHaveBeenCalled();
  });
});
