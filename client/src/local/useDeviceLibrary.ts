/**
 * Device library state (spec 26, Sprint 2).
 *
 * Wraps the replica and the native filesystem behind React state. All the real
 * logic lives in `replica.ts` / `download.ts`, which have no React dependency
 * and are unit-tested directly; this only arranges loading, progress and
 * refreshes.
 *
 * Deliberately **not** merged into `useLibrary`. That hook is the live server
 * view and is used by the PWA and the browser dev app, neither of which has a
 * device library. Keeping them apart means offline support cannot regress the
 * online path.
 */

import { useCallback, useEffect, useState } from "react";
import type { Audiobook } from "../types";
import { apiUrl, boundedFetch, getServerUrl, profileHeaders } from "../lib/api";
import { copy } from "../copy";
import { deviceFiles, localDb } from "./device";
import { downloadBook as runDownload, trackStreamUrl, type DownloadProgress } from "./download";
import {
  bookBytes,
  downloadedTracks,
  isFullyDownloaded,
  listReplicaBooks,
  removeDownloadedBook,
  replicaBookKey,
  totalReplicaBytes,
} from "./replica";
import { listUnclaimedOnDevice, recoverBooks, type RecoveryResult } from "./recover";
import { readProgress } from "./privateCache";
import type { ReplicaBook } from "./db";

export interface DeviceLibrary {
  /** Downloaded books, as plain `Audiobook[]` for the existing grid/search.
   *
   * The union across the device's per-server shelves (spec 30): every book the
   * device downloaded or adopted, whatever server it belongs to.
   */
  books: Audiobook[];
  /** Raw replica rows, keyed by local composite key (`<serverId>#<bookId>`). */
  rows: Record<string, ReplicaBook>;
  loading: boolean;
  /**
   * Why the replica could not be read, or null when it was read fine.
   *
   * This is deliberately a message rather than a swallowed catch. A replica
   * that will not open used to look exactly like a device with nothing on it,
   * and the app then told the listener "nothing has been downloaded" while the
   * audio sat on disk. `OfflineNotice` needs to be able to say "may still be
   * here" instead.
   */
  libraryReadError: string | null;
  /**
   * Book ids whose audio is on the phone but has no replica row (spec 29).
   *
   * Detection only: nothing is adopted until `recover` runs, and that needs the
   * server to confirm the catalogue entry. Empty when the filesystem cannot be
   * listed, so detection never becomes a visible failure. Ids are the connected
   * server's books, because detection maps orphan folders onto the catalogue it
   * can confirm (spec 30's shelves make the mapping per-server).
   */
  unclaimed: number[];
  /** Rebuild replica rows for `unclaimed` from the server, then refresh. */
  recover: () => Promise<RecoveryResult>;
  usedBytes: number;
  /** Reload from IndexedDB. */
  refresh: () => Promise<void>;
  isDownloaded: (bookId: number, serverId?: string) => boolean;
  /** Fraction downloaded, 0..1. Partial downloads report their real progress. */
  progressOf: (bookId: number, serverId?: string) => number;
  bytesFor: (bookId: number, serverId?: string) => number;
  download: (book: Audiobook, onProgress?: (p: DownloadProgress) => void) => Promise<void>;
  remove: (bookId: number, serverId?: string) => Promise<{ failed: string[] }>;
  /**
   * A playable URL for a downloaded track, or undefined when it is not on the
   * device. The caller falls back to streaming.
   */
  localUrlForTrack: (bookId: number, trackId: number, serverId?: string) => Promise<string | undefined>;
}

export function useDeviceLibrary(enabled: boolean): DeviceLibrary {
  const [rows, setRows] = useState<Record<string, ReplicaBook>>({});
  // Start "loading" whenever the library is enabled: the first paint must not
  // claim the device is empty before IndexedDB has been asked.
  const [loading, setLoading] = useState(enabled);
  const [libraryReadError, setLibraryReadError] = useState<string | null>(null);
  const [unclaimed, setUnclaimed] = useState<number[]>([]);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setRows({});
      setLoading(false);
      setLibraryReadError(null);
      setUnclaimed([]);
      return;
    }
    setLoading(true);
    setLibraryReadError(null);
    try {
      // The offline library is the union of the device's per-server shelves
      // (spec 30): every downloaded or adopted book, whatever server it belongs
      // to. Rows are keyed by `<serverId>#<bookId>`, so shelves do not collide.
      const all = await listReplicaBooks(localDb);
      const next: Record<string, ReplicaBook> = {};
      for (const row of all) {
        // The replica stores only shared metadata. Progress is private and
        // comes back from the encrypted rows when the profile key is unlocked;
        // without a key the book is still playable, just with no resume point.
        const progress = await readProgress(row.book.id);
        next[row.bookKey] = progress ? { ...row, book: { ...row.book, progress } } : row;
      }
      setRows(next);
      // Files that outlived their row: audio from before an origin change, or
      // from a database that was cleared. Read after the rows so `known` is
      // exactly what the app can currently see.
      //
      // The claimed set is the union across the device's shelves (spec 30): a
      // file under `books/<id>/` belongs to whichever shelf holds a row for
      // that id, even one whose server the app is no longer pointed at. Only
      // when no row anywhere claims a folder is it orphan audio worth adopting.
      const claimed = new Set(Object.values(next).map((row) => row.book.id));
      setUnclaimed(await listUnclaimedOnDevice(deviceFiles, claimed));
    } catch (error) {
      // A replica that will not open must not break the app -- but it must not
      // be reported as an empty library either. Keep the server view usable and
      // remember why the device view is missing, so the offline screen can say
      // so instead of pretending there is nothing here.
      console.error("Could not read the on-device audiobook library.", error);
      setRows({});
      setLibraryReadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isDownloaded = useCallback(
    (bookId: number, serverId?: string) =>
      isFullyDownloaded(rows[replicaBookKey(serverId ?? getServerUrl(), bookId)]),
    [rows],
  );

  const progressOf = useCallback(
    (bookId: number, serverId?: string) => {
      const row = rows[replicaBookKey(serverId ?? getServerUrl(), bookId)];
      if (!row) return 0;
      const expected = row.book.tracks?.length ?? 0;
      if (expected === 0) return 0;
      return Math.min(1, downloadedTracks(row).length / expected);
    },
    [rows],
  );

  const download = useCallback(
    async (book: Audiobook, onProgress?: (p: DownloadProgress) => void) => {
      await runDownload(
        book,
        {
          db: localDb,
          files: deviceFiles,
          trackUrl: trackStreamUrl,
          // The book carries its shelf (spec 30); a book adopted or downloaded
          // from another server must land there, not in whatever shelf the app
          // is currently pointed at.
          sourceServer: book.serverId ?? getServerUrl(),
        },
        onProgress,
      );
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (bookId: number, serverId?: string) => {
      const result = await removeDownloadedBook(localDb, deviceFiles, bookId, serverId ?? getServerUrl());
      await refresh();
      return { failed: result.failed };
    },
    [refresh],
  );

  /**
   * Adopt the audio that is already here (spec 29, per-server shelf in spec 30).
   *
   * The server is the authority on what the files are: a folder is only a book
   * if `GET /api/audiobooks/:id` confirms it. Offline this throws before
   * touching anything, which is what the caller promises to the listener.
   */
  const recover = useCallback(async (): Promise<RecoveryResult> => {
    const result = await recoverBooks(unclaimed, {
      db: localDb,
      files: deviceFiles,
      sourceServer: getServerUrl(),
      fetchBook: async (bookId) => {
        const response = await boundedFetch(apiUrl(`/api/audiobooks/${bookId}`), {
          credentials: "include",
          headers: profileHeaders(),
        });
        // 404 is the one answer that means "this folder is not a book any
        // more". Every other failure is "could not ask", which must not be
        // mistaken for a deleted book -- nothing is removed either way.
        if (response.status === 404) return "missing";
        if (!response.ok) throw new Error(copy.offline.recoverFailed);
        return (await response.json()) as Audiobook;
      },
    });
    await refresh();
    return result;
  }, [unclaimed, refresh]);

  const localUrlForTrack = useCallback(
    async (bookId: number, trackId: number, serverId?: string) => {
      const row = rows[replicaBookKey(serverId ?? getServerUrl(), bookId)];
      const track = row?.tracks[String(trackId)];
      if (!track) return undefined;
      try {
        return await deviceFiles.playableUrl(track.path);
      } catch {
        // The file is recorded but unreadable (removed by the OS, or a partial
        // write). Fall back to streaming rather than failing playback.
        return undefined;
      }
    },
    [rows],
  );

  const bytesFor = useCallback(
    (bookId: number, serverId?: string) => bookBytes(rows[replicaBookKey(serverId ?? getServerUrl(), bookId)]),
    [rows],
  );

  return {
    books: Object.values(rows).map((row) => ({ ...row.book, serverId: row.serverId })),
    rows,
    loading,
    libraryReadError,
    unclaimed,
    recover,
    usedBytes: Object.values(rows).reduce((total, row) => total + bookBytes(row), 0),
    refresh,
    isDownloaded,
    progressOf,
    bytesFor,
    download,
    remove,
    localUrlForTrack,
  };
}

export { totalReplicaBytes };
export type { DownloadProgress };
