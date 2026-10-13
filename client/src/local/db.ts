/**
 * Device-side read replica (spec 26, Sprint 2; ADR 012).
 *
 * The device is a **player with a read replica**, not a second library manager.
 * That is what keeps this to two stores instead of a port of the server's ~22
 * tables: the phone never scans, enriches, tags or categorises, so it only ever
 * needs to *read back* what the server already decided.
 *
 * ## What is stored
 *
 * Only **downloaded** books, and only when they are downloaded. The replica is
 * not a general cache of the library, because a cache would have to decide when
 * to go stale, and a stale genre or series shelf is worse than a missing one --
 * the ADR already accepts that "the UI must show what is local". Tying the
 * replica to the download is also self-healing: re-downloading refreshes the
 * metadata, so there is no separate expiry to reason about.
 *
 * ## Why no indexes
 *
 * Search (`lib/search.ts`) and browse (`lib/browse.ts`) are pure functions over
 * an in-memory `Audiobook[]`. Adding IndexedDB indexes for a query surface that
 * never queries IndexedDB would be work with no user-visible payoff. Books are
 * small (tens of KB, and only the downloaded subset), so reading the whole
 * table is the right shape.
 */

import Dexie, { type Table } from "dexie";
import type { Audiobook } from "../types";

/** One downloaded audio file on the device filesystem. */
export interface DownloadedTrack {
  trackId: number;
  /**
   * Path relative to `Directory.Data`, e.g. `books/42/7.mp3`.
   *
   * Stored relative rather than as the absolute path `getUri` returns, so the
   * record survives the app's data directory moving between installs or being
   * relocated by Android. It is resolved to a playable URL at read time.
   */
  path: string;
  /** Size on disk in bytes; summed for the storage screen. */
  bytes: number;
  downloadedAt: string;
}

export interface ReplicaBook {
  /**
   * The server's `Audiobook.id`, duplicated at the top level.
   *
   * Not redundant: the table is declared `books: "id"`, an *inbound* primary
   * key, so IndexedDB reads the key off the stored object itself. Without this
   * field every write fails with a DataError. Keeping it explicit also means the
   * row is identifiable without unpacking `book`.
   */
  id: number;
  /** The server's `Audiobook` row, verbatim. */
  book: Audiobook;
  /** When this replica entry was last refreshed from the server. */
  fetchedAt: string;
  /**
   * Downloaded tracks keyed by `trackId`.
   *
   * A plain record rather than an array because track order in `book.tracks` is
   * authoritative and lookups here are always by id.
   */
  tracks: Record<string, DownloadedTrack>;
}

export class LocalLibraryDatabase extends Dexie {
  books!: Table<ReplicaBook, number>;

  constructor(name = "audiobooks") {
    super(name);
    // Bump only when the stored shape changes. Replica rows are disposable --
    // a book can always be re-downloaded from the server -- so the upgrade path
    // is a delete and re-download rather than a migration.
    this.version(1).stores({ books: "id" });
  }
}

/** The app's database. Tests construct their own with a unique name. */
export const localDb = new LocalLibraryDatabase();