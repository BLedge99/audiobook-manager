/**
 * Download recovery (spec 29, phase 5).
 *
 * ## The loss this repairs
 *
 * Downloads live in two places: the audio files (`books/<bookId>/<trackId>.<ext>`)
 * and the replica rows in IndexedDB that describe which books and tracks they
 * belong to. The files survive an app-data scare far more often than the rows
 * do -- moving the WebView origin from `http://localhost` to
 * `https://localhost` (ADR 014) left gigabytes of audio behind with nothing in
 * the database pointing at it. From the listener's side that is "my books
 * disappeared"; from the filesystem's side nothing was lost at all.
 *
 * ## What this deliberately does not do
 *
 * It does not guess. A directory becomes a book only if its name is a numeric
 * id the server confirms and the files inside match track ids that book really
 * has. No metadata is invented from filenames, nothing is deleted without a
 * tap, and the old encryption keys (and therefore the old progress) are not
 * recoverable -- only the audio and the catalogue metadata are.
 */

import type { Audiobook } from "../types";
import type { DownloadedTrack, LocalLibraryDatabase } from "./db";
import {
  BOOK_DIR,
  putDownloadedTrack,
  putReplicaBook,
  trackPath,
  type FileSystemPort,
} from "./replica";

/** A directory name is a book id only when it is plainly one. */
export function parseBookDirectory(name: string): number | null {
  // Digits only, no sign, no leading zero: `books/007` is not the same book as
  // `books/7`, and anything else (a stray folder, `.nomedia`) is not a book.
  if (!/^[1-9]\d*$/.test(name)) return null;
  const id = Number(name);
  return Number.isSafeInteger(id) ? id : null;
}

/**
 * Book directories on the device that the replica does not know about.
 *
 * `knownIds` is what the app can currently see; anything numeric outside it is
 * audio that no row claims. Sorted, so the prompt and the tests are stable.
 */
export function findUnclaimedBookIds(directories: string[], knownIds: Iterable<number>): number[] {
  const known = new Set(knownIds);
  const found = new Set<number>();
  for (const directory of directories) {
    const id = parseBookDirectory(directory);
    if (id !== null && !known.has(id)) found.add(id);
  }
  return [...found].sort((a, b) => a - b);
}

/** One `books/` listing, best effort: detection is never allowed to break the app. */
export async function listUnclaimedOnDevice(
  files: FileSystemPort,
  knownIds: Iterable<number>,
): Promise<number[]> {
  try {
    return findUnclaimedBookIds(await files.listDir(BOOK_DIR), knownIds);
  } catch {
    // No `books/` directory yet, or a native listing failure. Either way the
    // honest answer is "we cannot see any", not an error on the shelf.
    return [];
  }
}

/** `<trackId>.<ext>`: the only file shape a download ever writes. */
export function parseTrackFile(name: string): { trackId: number; extension: string } | null {
  const match = /^([1-9]\d*)\.([a-z0-9]{1,5})$/i.exec(name);
  if (!match) return null;
  return { trackId: Number(match[1]), extension: match[2].toLowerCase() };
}

/**
 * Files in a book's folder that belong to that book's real tracks.
 *
 * Unmatched files are ignored rather than adopted: a half-written temp file or
 * a folder from another app must not appear as a chapter. Duplicate ids keep
 * the first extension seen, because the server's track list is the authority on
 * how many tracks there are.
 */
export function matchTrackFiles(
  book: Audiobook,
  fileNames: string[],
): { trackId: number; extension: string }[] {
  const wanted = new Set((book.tracks ?? []).map((track) => track.id));
  const matches: { trackId: number; extension: string }[] = [];
  const seen = new Set<number>();
  for (const name of fileNames) {
    const parsed = parseTrackFile(name);
    if (!parsed || !wanted.has(parsed.trackId) || seen.has(parsed.trackId)) continue;
    seen.add(parsed.trackId);
    matches.push(parsed);
  }
  return matches;
}

/** `"missing"` means the server said 404; a thrown error means it could not ask. */
export type BookLookup = (id: number) => Promise<Audiobook | "missing">;

export interface RecoveryDeps {
  db: LocalLibraryDatabase;
  files: FileSystemPort;
  fetchBook: BookLookup;
  /** Injected for stable timestamps in tests. */
  now?: () => Date;
  /**
   * The server the adoption is run against, and the shelf the adopted rows are
   * tagged into (spec 30). Defaults to the empty string for callers that manage
   * provenance themselves.
   */
  sourceServer?: string;
}

export interface RecoveryResult {
  /** Books rebuilt, with the number of real tracks adopted for each. */
  recovered: { bookId: number; title: string; tracks: number }[];
  /** The server does not have this book any more; the folder is left alone. */
  missing: number[];
  /** The server has the book but the folder held nothing it recognises. */
  unmatched: number[];
  /** The folder or the server could not be read; nothing was changed. */
  unreadable: number[];
}

/**
 * Rebuild replica rows from the files that are really on the phone.
 *
 * Reuses `putReplicaBook` / `putDownloadedTrack`, so a recovered book is
 * indistinguishable from one that downloaded normally: partial books stay
 * partial, complete books become playable immediately, and nothing is deleted.
 * Ids make this idempotent -- running it twice cannot duplicate a track.
 */
export async function recoverBooks(
  bookIds: number[],
  deps: RecoveryDeps,
): Promise<RecoveryResult> {
  const result: RecoveryResult = { recovered: [], missing: [], unmatched: [], unreadable: [] };
  const now = deps.now ?? (() => new Date());

  for (const bookId of bookIds) {
    let book: Audiobook | "missing";
    try {
      book = await deps.fetchBook(bookId);
    } catch {
      result.unreadable.push(bookId);
      continue;
    }
    if (book === "missing") {
      result.missing.push(bookId);
      continue;
    }

    let names: string[];
    try {
      names = await deps.files.listDir(`${BOOK_DIR}/${bookId}`);
    } catch {
      result.unreadable.push(bookId);
      continue;
    }

    const matches = matchTrackFiles(book, names);
    if (matches.length === 0) {
      result.unmatched.push(bookId);
      continue;
    }

    // Adopt: the metadata row first, then the matched tracks against it. The
    // adoption is tagged with the server it ran against (spec 30), so the audio
    // now lives in that server's shelf.
    await putReplicaBook(deps.db, book, {}, deps.sourceServer ?? "");
    const downloadedAt = now().toISOString();
    for (const match of matches) {
      const path = trackPath(bookId, match.trackId, match.extension);
      let bytes = 0;
      try {
        bytes = await deps.files.stat(path);
      } catch {
        // The listing said the file exists; a failed stat is not a reason to
        // abandon the book. It simply reports zero bytes until re-downloaded.
      }
      const track: DownloadedTrack = { trackId: match.trackId, path, bytes, downloadedAt };
      await putDownloadedTrack(deps.db, bookId, track, deps.sourceServer ?? "");
    }

    result.recovered.push({ bookId, title: book.title, tracks: matches.length });
  }

  return result;
}
