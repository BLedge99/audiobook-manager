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
import { deviceFiles, localDb } from "./device";
import { downloadBook as runDownload, trackStreamUrl, type DownloadProgress } from "./download";
import {
  bookBytes,
  downloadedTracks,
  isFullyDownloaded,
  listReplicaAudiobooks,
  removeDownloadedBook,
  totalReplicaBytes,
} from "./replica";
import { readProgress } from "./privateCache";
import type { ReplicaBook } from "./db";

export interface DeviceLibrary {
  /** Downloaded books, as plain `Audiobook[]` for the existing grid/search. */
  books: Audiobook[];
  /** Raw replica rows, for download state and byte counts. */
  rows: Record<number, ReplicaBook>;
  loading: boolean;
  usedBytes: number;
  /** Reload from IndexedDB. */
  refresh: () => Promise<void>;
  isDownloaded: (bookId: number) => boolean;
  /** Fraction downloaded, 0..1. Partial downloads report their real progress. */
  progressOf: (bookId: number) => number;
  bytesFor: (bookId: number) => number;
  download: (book: Audiobook, onProgress?: (p: DownloadProgress) => void) => Promise<void>;
  remove: (bookId: number) => Promise<{ failed: string[] }>;
  /**
   * A playable URL for a downloaded track, or undefined when it is not on the
   * device. The caller falls back to streaming.
   */
  localUrlForTrack: (bookId: number, trackId: number) => Promise<string | undefined>;
}

export function useDeviceLibrary(enabled: boolean): DeviceLibrary {
  const [rows, setRows] = useState<Record<number, ReplicaBook>>({});
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setRows({});
      return;
    }
    setLoading(true);
    try {
      const list = await listReplicaAudiobooks(localDb);
      // Re-read the rows rather than rebuilding them from the projection, so
      // `tracks` and `fetchedAt` stay available to the UI.
      const raw = await Promise.all(list.map((book) => localDb.books.get(book.id)));
      const next: Record<number, ReplicaBook> = {};
      for (const row of raw) {
        if (!row) continue;
        // The replica stores only shared metadata. Progress is private and
        // comes back from the encrypted rows when the profile key is unlocked;
        // without a key the book is still playable, just with no resume point.
        const progress = await readProgress(row.id);
        next[row.id] = progress
          ? { ...row, book: { ...row.book, progress } }
          : row;
      }
      setRows(next);
    } catch {
      // A replica that will not open must not break the app; the server view
      // is still usable and the device library is simply empty.
      setRows({});
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isDownloaded = useCallback(
    (bookId: number) => isFullyDownloaded(rows[bookId]),
    [rows],
  );

  const progressOf = useCallback(
    (bookId: number) => {
      const row = rows[bookId];
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
        },
        onProgress,
      );
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (bookId: number) => {
      const result = await removeDownloadedBook(localDb, deviceFiles, bookId);
      await refresh();
      return { failed: result.failed };
    },
    [refresh],
  );

  const localUrlForTrack = useCallback(
    async (bookId: number, trackId: number) => {
      const row = rows[bookId];
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

  const bytesFor = useCallback((bookId: number) => bookBytes(rows[bookId]), [rows]);

  return {
    books: Object.values(rows).map((row) => row.book),
    rows,
    loading,
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
