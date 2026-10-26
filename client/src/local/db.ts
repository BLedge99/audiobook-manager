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

/**
 * One cached cover.
 *
 * The `Blob` is stored rather than a data URI: a base64 string costs a third
 * more memory, and this is the one place in the app where bytes are large enough
 * for that to matter.
 */
/**
 * The password-wrapped profile key (spec 28, phase 4).
 *
 * Only the wrapped DEK is stored. The KEK is derived from the password on
 * unlock and is never persisted, so reading this row gives an attacker a
 * scrypt problem rather than a key.
 */
export interface KeyEnvelopeRecord {
  profileId: number;
  version: 1;
  /** Base64 16-byte scrypt salt. */
  salt: string;
  /** Base64 12-byte AES-GCM nonce used to wrap the DEK. */
  iv: string;
  /** Base64 AES-256-GCM ciphertext plus tag. */
  wrappedKey: string;
  createdAt: string;
}

/** One encrypted private row. The row key is plaintext; the value is not. */
export interface PrivateRowRecord {
  /** `${profileId}:${table}:${rowKey}`. */
  id: string;
  profileId: number;
  table: string;
  rowKey: string;
  version: 1;
  /** Base64 12-byte AES-GCM nonce. */
  iv: string;
  /** Base64 ciphertext plus tag. */
  ciphertext: string;
  updatedAt: string;
}

export interface CoverRecord {
  /**
   * `book:<id>` for a book's own cover, `url:<href>` for a provider URL.
   *
   * Keyed by identity rather than by request URL so the cache survives a session
   * token changing -- the token is in the cover URL's query string, and keying
   * on the full URL would strand every cached cover on the next login.
   */
  key: string;
  blob: Blob;
  /** The server's ETag for these bytes, replayed as `If-None-Match`. */
  etag: string | null;
  /** When these bytes were stored. Also the eviction order. */
  savedAt: number;
  bytes: number;
}

export class LocalLibraryDatabase extends Dexie {
  books!: Table<ReplicaBook, number>;
  covers!: Table<CoverRecord, string>;
  keyEnvelopes!: Table<KeyEnvelopeRecord, number>;
  privateRows!: Table<PrivateRowRecord, string>;

  constructor(name = "audiobooks") {
    super(name);
    // Bump only when the stored shape changes. Replica rows are disposable --
    // a book can always be re-downloaded from the server -- so the upgrade path
    // is a delete and re-download rather than a migration.
    this.version(1).stores({ books: "id" });
    // Spec 15b feature 1. Additive only: version 1's `books` rows are left
    // exactly as they are, so every already-downloaded book survives the
    // upgrade. Covers are re-fetchable, which is the whole point of caching
    // them, so there is nothing here worth migrating.
    this.version(2).stores({ books: "id", covers: "&key" });
    // Spec 28, phase 4. Additive again: the downloaded-book rows and covers
    // survive. `privateRows` is indexed by profile and table so a lock or an
    // admin reset can delete one profile's cache without touching shared data.
    this.version(3).stores({
      books: "id",
      covers: "&key",
      keyEnvelopes: "&profileId",
      privateRows: "&id, [profileId+table]",
    });
  }
}

/** The app's database. Tests construct their own with a unique name. */
export const localDb = new LocalLibraryDatabase();