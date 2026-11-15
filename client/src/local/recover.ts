/**
 * Download recovery (spec 29, phase 5).
 *
 * ## The loss this repairs
 *
 * Downloads live in two places: the audio files and the replica rows in
 * IndexedDB that describe which books and tracks they belong to. The files
 * survive an app-data scare far more often than the rows do -- moving the
 * WebView origin from `http://localhost` to `https://localhost` (ADR 014) left
 * gigabytes of audio behind with nothing in the database pointing at it. From
 * the listener's side that is "my books disappeared"; from the filesystem's
 * side nothing was lost at all.
 *
 * ## Where the audio lives
 *
 * New downloads write `books/srv-<hash>/<bookId>/` (spec 41): the replica
 * rows have always been scoped per server, and now the files are too, so two
 * servers that both number their books from 1 can never share a folder.
 * Detected-but-unrecoverable audio in the pre-41 layout (`books/<id>/`) is
 * adopted into the current shelf **without moving the files** -- the rows
 * keep the legacy paths, because that is where the bytes really are.
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
  bookDir,
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

/**
 * What unclaimed audio sits on the device, for one shelf.
 *
 * Two layouts exist side by side during the spec-41 transition:
 *
 *  - per-server, `books/srv-<hash>/<bookId>` — what downloads write now;
 *    scanned only for `sourceServer`, and only against the ids that shelf
 *    claims, so another server's shelf can never surface as "unclaimed" audio;
 *  - legacy, `books/<bookId>` — what the pre-41 layout wrote; scanned at the
 *    root against the union of everything the device claims, because audio in
 *    a legacy folder cannot be attributed to a shelf.
 *
 * Best effort: detection is never allowed to break the app.
 */
export async function listUnclaimedOnDevice(
  files: FileSystemPort,
  knownIds: Iterable<number>,
  sourceServer = "",
  sourceServerKnownIds?: Iterable<number>,
): Promise<number[]> {
  const union = new Set(knownIds);
  const server = new Set(sourceServerKnownIds ?? [...union]);
  try {
    const root = await files.listDir(BOOK_DIR);
    const found = new Set<number>();
    const shelfDir = bookDir(sourceServer);
    if (root.includes(shelfDir)) {
      let shelfEntries: string[] = [];
      try {
        shelfEntries = await files.listDir(`${BOOK_DIR}/${shelfDir}`);
      } catch {
        // Unreadable shelf dir: treat as empty, not as a failure of detection.
      }
      for (const id of findUnclaimedBookIds(shelfEntries, server)) found.add(id);
    }
    for (const id of findUnclaimedBookIds(root, union)) found.add(id);
    return [...found].sort((a, b) => a - b);
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

/** Per-book candidate directories, in preference order: current layout first. */
function adoptionLayouts(
  sourceServer: string,
  bookId: number,
): { tag: "per-server" | "legacy"; dir: string; pathFor: (trackId: number, extension: string) => string }[] {
  return [
    {
      tag: "per-server",
      dir: `${BOOK_DIR}/${bookDir(sourceServer)}/${bookId}`,
      pathFor: (trackId, extension) => trackPath(sourceServer, bookId, trackId, extension),
    },
    {
      tag: "legacy",
      dir: `${BOOK_DIR}/${bookId}`,
      pathFor: (trackId, extension) => `${BOOK_DIR}/${bookId}/${trackId}.${extension.replace(/^\./, "")}`,
    },
  ];
}

/**
 * Rebuild replica rows from the files that are really on the phone.
 *
 * Reuses `putReplicaBook` / `putDownloadedTrack`, so a recovered book is
 * indistinguishable from one that downloaded normally: partial books stay
 * partial, complete books become playable immediately, and nothing is deleted.
 * Ids make this idempotent -- running it twice cannot duplicate a track.
 *
 * Per-server layout is preferred; the legacy layout is consulted when the
 * per-server folder is missing or holds nothing recognisable, and adopted
 * rows keep the legacy path -- the files really live there, and nothing is
 * moved behind the listener's back.
 */
export async function recoverBooks(
  bookIds: number[],
  deps: RecoveryDeps,
): Promise<RecoveryResult> {
  const result: RecoveryResult = { recovered: [], missing: [], unmatched: [], unreadable: [] };
  const now = deps.now ?? (() => new Date());
  const sourceServer = deps.sourceServer ?? "";

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

    let sawListing = false;
    let matches: ReturnType<typeof matchTrackFiles> = [];
    let pathFor: ((trackId: number, extension: string) => string) | null = null;
    for (const candidate of adoptionLayouts(sourceServer, bookId)) {
      let listing: string[];
      try {
        listing = await deps.files.listDir(candidate.dir);
      } catch {
        continue;
      }
      const found = matchTrackFiles(book, listing);
      sawListing = true;
      matches = found;
      pathFor = candidate.pathFor;
      if (found.length > 0) break;
      // A readable folder with nothing recognisable: fall through to legacy,
      // but remember it was readable even if legacy is not.
    }

    if (!sawListing || pathFor === null) {
      result.unreadable.push(bookId);
      continue;
    }
    if (matches.length === 0) {
      result.unmatched.push(bookId);
      continue;
    }

    // Adopt: the metadata row first, then the matched tracks against it. The
    // adoption is tagged with the server it ran against (spec 30), so the audio
    // now lives in that server's shelf.
    await putReplicaBook(deps.db, book, {}, sourceServer);
    const downloadedAt = now().toISOString();
    for (const match of matches) {
      const path = pathFor(match.trackId, match.extension);
      let bytes = 0;
      try {
        bytes = await deps.files.stat(path);
      } catch {
        // The listing said the file exists; a failed stat is not a reason to
        // abandon the book. It simply reports zero bytes until re-downloaded.
      }
      const track: DownloadedTrack = { trackId: match.trackId, path, bytes, downloadedAt };
      await putDownloadedTrack(deps.db, bookId, track, sourceServer);
    }

    result.recovered.push({ bookId, title: book.title, tracks: matches.length });
  }

  return result;
}
