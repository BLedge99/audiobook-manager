/**
 * Replica read/write (spec 26, Sprint 2).
 *
 * Deliberately free of React and of Capacitor: every function here takes the
 * database (and, where relevant, a filesystem port) as an argument, so the
 * whole store is exercisable in jsdom via `fake-indexeddb` and an in-memory
 * fake. Only `device.ts` wires in the real native plugins.
 */

import type { Audiobook } from "../types";
import { type DownloadedTrack, type LocalLibraryDatabase, type ReplicaBook } from "./db";

export interface FileSystemPort {
  /**
   * Stream `url` to `path`, creating parent directories.
   *
   * `expectedBytes` is the Content-Length the server reported (0 when unknown),
   * so the caller can check the file it got is complete rather than trusting a
   * resolved promise.
   */
  download(options: {
    url: string;
    path: string;
    headers?: Record<string, string>;
    onProgress?: (fraction: number) => void;
  }): Promise<{ path: string; bytes: number; expectedBytes: number }>;
  remove(path: string): Promise<void>;
  /** Size of a file in bytes, relative to the replica's directory. */
  stat(path: string): Promise<number>;
  /**
   * Names of the entries directly under `path`.
   *
   * Used by download recovery (spec 29): audio can outlive the database row
   * that pointed at it, and the only remaining record of those books is the
   * directory names under `books/`. Throws when the directory cannot be read;
   * a missing directory and an unreadable one are different findings.
   */
  listDir(path: string): Promise<string[]>;
  /** A URL an `<audio>` element can play and seek within. */
  playableUrl(path: string): Promise<string>;
}

/** Directory prefix for downloaded audio, relative to `Directory.Data`. */
export const BOOK_DIR = "books";

/**
 * Local primary key for one downloaded book: `<serverId>#<bookId>`.
 *
 * Composite because the offline library is a set of per-server shelves (spec
 * 30) and two different servers can both number their books from 1.
 */
export function replicaBookKey(serverId: string, bookId: number): string {
  return `${serverId}#${bookId}`;
}

/**
 * Where one track is stored.
 *
 * Keyed by book and track id rather than the track's filename: filenames come
 * from the media files and can collide or contain characters the filesystem
 * dislikes, whereas ids are stable and already safe.
 */
export function trackPath(bookId: number, trackId: number, extension = "mp3"): string {
  return `${BOOK_DIR}/${bookId}/${trackId}.${extension.replace(/^\./, "")}`;
}

/** The file extension to save a track under, from its server-reported format. */
export function extensionFor(fileFormat: string | undefined): string {
  const format = (fileFormat ?? "").trim().toLowerCase().replace(/^\./, "");
  // Only letters/digits, so a hostile or odd value cannot escape the directory.
  return /^[a-z0-9]{1,5}$/.test(format) ? format : "mp3";
}

function key(trackId: number): string {
  return String(trackId);
}

/** Every downloaded book, newest metadata fetch first is not guaranteed. */
export async function listReplicaBooks(
  db: LocalLibraryDatabase,
  serverId?: string,
): Promise<ReplicaBook[]> {
  const rows = await db.books.toArray();
  const list = serverId ? rows.filter((row) => row.serverId === serverId) : rows;
  return list;
}

/**
 * The replica as plain `Audiobook[]`, for the existing browse/search/grid code.
 *
 * Projects out the replica bookkeeping so nothing downstream can mistake a
 * stale local copy for live server state.
 *
 * When `serverId` is given only that server's shelf is returned; otherwise the
 * union across shelves is (the offline shelf is the union, spec 30).
 */
export async function listReplicaAudiobooks(
  db: LocalLibraryDatabase,
  serverId?: string,
): Promise<Audiobook[]> {
  const rows = await listReplicaBooks(db, serverId);
  return rows.map((row) => row.book);
}

/** How many books are available offline. */
export async function countReplicaBooks(db: LocalLibraryDatabase, serverId?: string): Promise<number> {
  const rows = await listReplicaBooks(db, serverId);
  return rows.length;
}

/**
 * The shared half of a book row.
 *
 * `progress`, `favourited` and `inLibrary` are profile-private and live in
 * encrypted rows instead (spec 28). Stripping them here is what keeps a
 * downloaded book's plaintext replica from leaking who listened to what. The
 * public catalogue fields -- title, author, tracks, cover identity -- stay.
 */
function sharedReplicaBook(book: Audiobook): Audiobook {
  const {
    progress: _progress,
    favourited: _favourited,
    inLibrary: _inLibrary,
    ...shared
  } = book;
  return shared;
}

/** Record that a book is on the device, refreshing its metadata. */
export async function putReplicaBook(
  db: LocalLibraryDatabase,
  book: Audiobook,
  tracks: Record<number, DownloadedTrack> = {},
  serverId = "",
): Promise<void> {
  const key = replicaBookKey(serverId, book.id);
  const existing = await db.books.get(key);
  await db.books.put({
    bookKey: key,
    serverId,
    book: sharedReplicaBook(book),
    fetchedAt: new Date().toISOString(),
    // Preserve tracks already downloaded when only the metadata is refreshed,
    // so a metadata refresh never silently un-downloads a book.
    tracks: { ...(existing?.tracks ?? {}), ...tracks },
  });
}

/** Mark one track as downloaded, keeping the rest. */
export async function putDownloadedTrack(
  db: LocalLibraryDatabase,
  bookId: number,
  track: DownloadedTrack,
  serverId = "",
): Promise<void> {
  const bookKey = replicaBookKey(serverId, bookId);
  const existing = await db.books.get(bookKey);
  if (!existing) throw new Error(`No replica entry for book ${bookId}`);
  await db.books.put({
    ...existing,
    tracks: { ...existing.tracks, [key(track.trackId)]: track },
  });
}

/**
 * Is this book fully on the device?
 *
 * "Fully" means every track the server says the book has. A partial download is
 * reported as not downloaded, because the alternative is a book that appears
 * available and then runs out mid-chapter.
 */
export function isFullyDownloaded(row: ReplicaBook | undefined): boolean {
  if (!row) return false;
  const expected = row.book.tracks?.length ?? 0;
  if (expected === 0) return false;
  return row.book.tracks.every((track) => row.tracks[key(track.id)] !== undefined);
}

/** Tracks of a book that are on the device, in server order. */
export function downloadedTracks(row: ReplicaBook | undefined): DownloadedTrack[] {
  if (!row) return [];
  return (row.book.tracks ?? [])
    .map((track) => row.tracks[key(track.id)])
    .filter((track): track is DownloadedTrack => track !== undefined);
}

/** Bytes held for one book. */
export function bookBytes(row: ReplicaBook | undefined): number {
  return downloadedTracks(row).reduce((total, track) => total + track.bytes, 0);
}

/**
 * Forget a book and delete its audio.
 *
 * Order matters: the database record is removed **after** the files, so a
 * failure part-way leaves the record pointing at files that still exist. The
 * reverse order would leave orphaned gigabytes of audio with no way to find
 * them, because nothing else records where they went.
 *
 * Per-file failures are collected rather than thrown: a book with one
 * undeletable track should still be removed from the list, or the user can
 * never get it off the device.
 */
export async function removeDownloadedBook(
  db: LocalLibraryDatabase,
  files: FileSystemPort,
  bookId: number,
  serverId = "",
): Promise<{ removed: boolean; failed: string[] }> {
  const row = await db.books.get(replicaBookKey(serverId, bookId));
  if (!row) return { removed: false, failed: [] };

  const failed: string[] = [];
  for (const track of downloadedTracks(row)) {
    try {
      await files.remove(track.path);
    } catch {
      failed.push(track.path);
    }
  }

  await db.books.delete(replicaBookKey(serverId, bookId));
  return { removed: true, failed };
}

/**
 * Total bytes across every downloaded book.
 *
 * Summed from the replica rather than from `stat`, so it is available before
 * any filesystem permission is needed and costs no native calls.
 */
export async function totalReplicaBytes(db: LocalLibraryDatabase, serverId?: string): Promise<number> {
  const rows = await listReplicaBooks(db, serverId);
  return rows.reduce((total, row) => total + bookBytes(row), 0);
}