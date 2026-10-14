/**
 * Downloading a book to the device (spec 26, Sprint 2).
 *
 * ## Why native download, not fetch-then-write
 *
 * `Filesystem.writeFile` takes **base64** on Android -- the plugin's Blob
 * support is web-only. Base64-encoding a 30-hour audiobook would put the whole
 * file in memory and inflate it by a third, which on a phone is the difference
 * between working and an out-of-memory crash. `Filesystem.downloadFile` streams
 * URL to disk natively and accepts headers, so the bytes never enter JS at all.
 *
 * ## Why the replica entry is written first
 *
 * The metadata row is stored before any audio, because each track is recorded
 * against it as it lands. That makes a partially-downloaded book genuinely
 * resumable-in-effect (the tracks that arrived stay recorded) and lets the UI
 * show real progress rather than a spinner that either completes or fails.
 */

import { apiUrl, withSessionToken } from "../lib/api";
import { validateDownloadedSize } from "./device";
import { DownloadTrace } from "./trace";
import type { Audiobook, Track } from "../types";
import type { LocalLibraryDatabase } from "./db";
import {
  extensionFor,
  putDownloadedTrack,
  putReplicaBook,
  trackPath,
  type FileSystemPort,
} from "./replica";

export interface DownloadProgress {
  bookId: number;
  trackId: number;
  /** Tracks fully written so far. */
  completed: number;
  total: number;
  /** 0..1 across the whole book, including the in-flight track. */
  fraction: number;
  /** Bytes written for the in-flight track, if the plugin reported any. */
  trackFraction: number;
}

export interface DownloadDeps {
  db: LocalLibraryDatabase;
  files: FileSystemPort;
  /**
   * Absolute URL for a track's audio.
   *
   * Injected so the orchestration is testable without a server, and so the
   * per-track stream endpoint stays the caller's decision.
   */
  trackUrl: (trackId: number) => string;
  headers?: Record<string, string>;
  /** Injected for deterministic timestamps in tests. */
  now?: () => Date;
}

/**
 * The stream URL for one track, from the server's per-track endpoint.
 *
 * Carries the session token in the query string. `Filesystem.downloadFile` is a
 * native plugin call, so it bypasses the `fetch` shim that attaches the token
 * to every JS request -- without this the server answers 401 and the download
 * sits at "Downloading 0%" forever.
 */
export function trackStreamUrl(trackId: number): string {
  return withSessionToken(apiUrl(`/api/tracks/${trackId}/stream`));
}

/**
 * Per-stage budgets, in milliseconds.
 *
 * Every stage here is either a small metadata write or a single file transfer,
 * so these are generous. Their job is not to be tight -- it is to convert a
 * promise that never settles into a named, visible failure.
 */
export const STEP_BUDGETS = {
  /** Writing one book's metadata row to Dexie. */
  replicaWrite: 5_000,
  /** One track over a LAN or USB tunnel. A long track at a poor rate can take a while. */
  trackDownload: 180_000,
  /** stat on a file we just wrote. */
  stat: 10_000,
  /** Recording a completed track in Dexie. */
  trackRecord: 5_000,
} as const;

/**
 * Download every track of a book, recording metadata first and each track as it
 * lands.
 *
 * Stops at the first failure and rethrows. Tracks already written stay recorded
 * and their files stay on disk, so re-running skips nothing but retries the
 * failed one -- which is the right behaviour for a house move over flaky
 * WiFi, and far better than silently leaving a book that looks complete.
 *
 * Every await is wrapped in a traced, time-boxed `step`, so a failure names the
 * stage that broke rather than leaving the button spinning forever. See
 * `trace.ts` for why catching alone was not enough.
 */
export async function downloadBook(
  book: Audiobook,
  deps: DownloadDeps,
  onProgress?: (progress: DownloadProgress) => void,
  trace: DownloadTrace = new DownloadTrace(),
): Promise<void> {
  const tracks = book.tracks ?? [];
  if (tracks.length === 0) {
    throw new Error(`"${book.title}" has no tracks to download`);
  }

  const { now, extension } = await trace.step(
    `write replica metadata (${tracks.length} tracks)`,
    STEP_BUDGETS.replicaWrite,
    async () => {
      // Metadata first: every track below is recorded against this row.
      await putReplicaBook(deps.db, book);
      return { now: deps.now ?? (() => new Date()), extension: extensionFor(book.fileFormat) };
    },
  );

  for (let index = 0; index < tracks.length; index += 1) {
    const track = tracks[index];
    await downloadTrack(book, track, extension, index, tracks.length, deps, onProgress, now, trace);
  }
}

async function downloadTrack(
  book: Audiobook,
  track: Track,
  extension: string,
  index: number,
  total: number,
  deps: DownloadDeps,
  onProgress: ((progress: DownloadProgress) => void) | undefined,
  now: () => Date,
  trace: DownloadTrace,
): Promise<void> {
  const path = trackPath(book.id, track.id, extension);
  const label = `track ${index + 1}/${total}`;

  const result = await trace.step(`${label}: fetch audio`, STEP_BUDGETS.trackDownload, () =>
    deps.files.download({
      url: deps.trackUrl(track.id),
      path,
      headers: deps.headers,
      onProgress: (trackFraction) => {
        onProgress?.({
          bookId: book.id,
          trackId: track.id,
          completed: index,
          total,
          fraction: (index + clamp01(trackFraction)) / total,
          trackFraction: clamp01(trackFraction),
        });
      },
    }),
  );

  // Prefer the size the plugin reported; fall back to stat when it does not,
  // because the storage screen would otherwise under-report a book's footprint.
  const bytes = result?.bytes > 0 ? result.bytes : await sizeOf(deps.files, path, trace, label);

  // Check before recording anything. An HTTP error body is small and perfectly
  // valid to write to disk, so a "successful" download could otherwise leave a
  // book marked as on-device with no playable audio in it. That is worse than a
  // visible failure: the UI would say you have the book and you would only
  // discover otherwise offline.
  trace.step(`${label}: verify size`, STEP_BUDGETS.stat, () =>
    validateDownloadedSize(bytes, result?.expectedBytes ?? 0),
  );

  await trace.step(`${label}: record track`, STEP_BUDGETS.trackRecord, () =>
    putDownloadedTrack(deps.db, book.id, {
      trackId: track.id,
      path,
      bytes,
      downloadedAt: now().toISOString(),
    }),
  );

  onProgress?.({
    bookId: book.id,
    trackId: track.id,
    completed: index + 1,
    total,
    fraction: (index + 1) / total,
    trackFraction: 1,
  });
}

/**
 * Size of a file we just wrote.
 *
 * This used to `catch { return 0 }`, which silently turned *any* stat failure --
 * a plugin error, a permissions problem, a native crash -- into "the file is
 * zero bytes". That reported a broken download as a validation failure much
 * later, or worse, hid it entirely. It now distinguishes "not there" from "the
 * stat itself failed" and reports which.
 */
async function sizeOf(
  files: FileSystemPort,
  path: string,
  trace: DownloadTrace,
  label: string,
): Promise<number> {
  try {
    return await trace.step(`${label}: stat file`, STEP_BUDGETS.stat, () => files.stat(path));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read the size of the downloaded file: ${detail}`);
  }
}

/** Guard against a plugin reporting >1 or a negative fraction. */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}