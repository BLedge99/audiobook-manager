/**
 * The encrypted offline cache (spec 28, phase 4).
 *
 * ## What is encrypted and why
 *
 * Downloaded audio, covers and shared catalogue metadata stay readable: they
 * are household content and the user has already chosen to put them on the
 * device. Progress, favourites, wishlist and the rest of a profile's private
 * rows do not. A password hash would prove a password but would not stop anyone
 * with the unlocked IndexedDB from reading the rows, so the cache uses a real
 * key:
 *
 * - a random 32-byte DEK encrypts each private row with AES-256-GCM;
 * - the DEK is wrapped by a KEK derived from the profile password with scrypt;
 * - only the wrapped DEK is at rest, in `keyEnvelopes`.
 *
 * A reload or lock drops the in-memory DEK. Offline sign-in asks for the
 * password, derives the KEK and unwraps the DEK. A wrong password fails the
 * GCM authentication tag and changes nothing.
 *
 * ## Why the DEK is not password-derived directly
 *
 * Re-keying on a password change must not rewrite every row. It rewraps the one
 * 32-byte DEK instead.
 *
 * ## Scope
 *
 * This module is deliberately free of React and Capacitor. The Android Vault
 * stores the same DEK later; that is an additional place to keep it, not a
 * second encryption scheme.
 */

import { scryptAsync } from "@noble/hashes/scrypt";
import type { BookProgress, WishlistItem } from "../types";
import { localDb, type LocalLibraryDatabase } from "./db";

export const CACHE_VERSION = 1;
/** 16 bytes, per spec. */
const SALT_BYTES = 16;
/** AES-GCM standard nonce length. */
const IV_BYTES = 12;
const DEK_BYTES = 32;
const SCRYPT = {
  N: 32768,
  r: 8,
  p: 1,
  dkLen: DEK_BYTES,
  // 128 * N * r is ~32 MiB; leave headroom but cap a hostile/misconfigured
  // runtime rather than letting it allocate a gigabyte on a phone.
  maxmem: 64 * 1024 * 1024,
} as const;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class CacheKeyMissingError extends Error {
  constructor() {
    super("No offline cache is stored for this profile.");
    this.name = "CacheKeyMissingError";
  }
}

export class WrongPasswordError extends Error {
  constructor() {
    super("The password did not unwrap this profile's cache.");
    this.name = "WrongPasswordError";
  }
}

function subtle(): SubtleCrypto {
  const value = globalThis.crypto;
  if (!value?.subtle) {
    throw new Error("This browser cannot encrypt the offline cache.");
  }
  return value.subtle;
}

function randomBytes(length: number): Uint8Array {
  const value = globalThis.crypto;
  if (!value?.getRandomValues) throw new Error("No secure random source.");
  return value.getRandomValues(new Uint8Array(length));
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function dekAad(profileId: number): Uint8Array {
  return encoder.encode(`bookle:dek:v${CACHE_VERSION}:${profileId}`);
}

function rowAad(profileId: number, table: string, rowKey: string): Uint8Array {
  return encoder.encode(`bookle:row:v${CACHE_VERSION}:${profileId}:${table}:${rowKey}`);
}

export function profileRowId(profileId: number, table: string, rowKey: string): string {
  return `${profileId}:${table}:${rowKey}`;
}

/** Derive the 32-byte KEK. Exported for the cache tests. */
export async function deriveKek(
  password: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const raw = await scryptAsync(encoder.encode(password), salt, {
    ...SCRYPT,
    onProgress: undefined,
  });
  return subtle().importKey(
    "raw",
    raw,
    { name: "AES-GCM" },
    false,
    ["wrapKey", "unwrapKey"],
  );
}

async function generateDek(): Promise<CryptoKey> {
  return subtle().generateKey(
    { name: "AES-GCM", length: DEK_BYTES * 8 },
    true,
    ["encrypt", "decrypt", "wrapKey", "unwrapKey"],
  );
}

async function wrapDek(
  dek: CryptoKey,
  password: string,
  profileId: number,
): Promise<{
  salt: string;
  iv: string;
  wrappedKey: string;
}> {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const kek = await deriveKek(password, salt);
  const wrapped = await subtle().wrapKey(
    "raw",
    dek,
    kek,
    { name: "AES-GCM", iv, additionalData: dekAad(profileId) },
  );
  return {
    salt: toBase64(salt),
    iv: toBase64(iv),
    wrappedKey: toBase64(new Uint8Array(wrapped)),
  };
}

async function unwrapDek(
  envelope: { salt: string; iv: string; wrappedKey: string; profileId: number },
  password: string,
): Promise<CryptoKey> {
  const kek = await deriveKek(password, fromBase64(envelope.salt));
  try {
    return await subtle().unwrapKey(
      "raw",
      fromBase64(envelope.wrappedKey),
      kek,
      {
        name: "AES-GCM",
        iv: fromBase64(envelope.iv),
        additionalData: dekAad(envelope.profileId),
      },
      { name: "AES-GCM", length: DEK_BYTES * 8 },
      true,
      ["encrypt", "decrypt", "wrapKey", "unwrapKey"],
    );
  } catch {
    // WebCrypto reports an authentication failure as a DOMException. The
    // caller shows the same sentence as a wrong server password.
    throw new WrongPasswordError();
  }
}

/** The unlocked DEK, keyed by profile. Memory only; never persisted. */
const activeKeys = new Map<number, CryptoKey>();

/** Which profile the current in-memory key belongs to, if any. */
export function activeCacheProfileId(): number | null {
  const first = activeKeys.keys().next();
  return first.done ? null : first.value;
}

export function activeCacheKey(profileId: number): CryptoKey | undefined {
  return activeKeys.get(profileId);
}

export function lockOfflineCache(): void {
  activeKeys.clear();
}

/**
 * Create or unlock the profile's envelope after a successful password sign-in.
 *
 * If the envelope exists but the new password does not unwrap it, this is the
 * post-reset case: the old cache is unreadable by design, so it is deleted and
 * a fresh key is made. Nothing else can recover it, and leaving it behind would
 * only grow storage with ciphertext nobody can use.
 */
export async function rememberProfileKey(
  profileId: number,
  password: string,
  db: LocalLibraryDatabase = localDb,
): Promise<CryptoKey> {
  const existing = await db.keyEnvelopes.get(profileId);
  // Only one profile is unlocked at a time. Keeping stale keys would make
  // `activeCacheProfileId` ambiguous and could write a row under the previous
  // profile after a switch.
  activeKeys.clear();
  if (existing) {
    try {
      const key = await unwrapDek(existing, password);
      activeKeys.set(profileId, key);
      return key;
    } catch {
      await deleteProfileCache(profileId, db);
    }
  }

  const key = await generateDek();
  const wrapped = await wrapDek(key, password, profileId);
  await db.keyEnvelopes.put({
    profileId,
    version: CACHE_VERSION,
    ...wrapped,
    createdAt: new Date().toISOString(),
  });
  activeKeys.set(profileId, key);
  return key;
}

/** Unlock an existing envelope. Offline does not create one. */
export async function unlockProfileCache(
  profileId: number,
  password: string,
  db: LocalLibraryDatabase = localDb,
): Promise<CryptoKey> {
  const envelope = await db.keyEnvelopes.get(profileId);
  if (!envelope) throw new CacheKeyMissingError();
  const key = await unwrapDek(envelope, password);
  activeKeys.clear();
  activeKeys.set(profileId, key);
  return key;
}

export async function hasProfileCache(
  profileId: number,
  db: LocalLibraryDatabase = localDb,
): Promise<boolean> {
  return (await db.keyEnvelopes.get(profileId)) !== undefined;
}

/**
 * Rewrap the DEK with a new password. Rows are untouched.
 *
 * Call this only after the server has accepted the password change. If no
 * envelope exists, there is nothing on this device to rewrap.
 */
export async function rewrapProfileKey(
  profileId: number,
  oldPassword: string,
  newPassword: string,
  db: LocalLibraryDatabase = localDb,
): Promise<boolean> {
  const envelope = await db.keyEnvelopes.get(profileId);
  if (!envelope) return false;
  const key = await unwrapDek(envelope, oldPassword);
  const wrapped = await wrapDek(key, newPassword, profileId);
  await db.keyEnvelopes.put({
    ...envelope,
    ...wrapped,
    version: CACHE_VERSION,
    createdAt: new Date().toISOString(),
  });
  activeKeys.set(profileId, key);
  return true;
}

/** Forget every private row and the wrapped key for one profile. */
export async function deleteProfileCache(
  profileId: number,
  db: LocalLibraryDatabase = localDb,
): Promise<void> {
  // A filter rather than a compound range: this runs once on lock/reset, not
  // on a hot path, and the filter form cannot get an open-ended range sentinel
  // wrong on a future Dexie upgrade.
  const ids = await db.privateRows
    .filter((row) => row.profileId === profileId)
    .primaryKeys();
  await db.privateRows.bulkDelete(ids);
  await db.keyEnvelopes.delete(profileId);
  activeKeys.delete(profileId);
}

/** Encrypt and store one private value. A no-op when no key is unlocked. */
export async function putPrivateValue(
  table: string,
  rowKey: string,
  value: unknown,
  db: LocalLibraryDatabase = localDb,
): Promise<boolean> {
  const profileId = activeCacheProfileId();
  if (profileId === null) return false;
  const key = activeKeys.get(profileId);
  if (!key) return false;

  const iv = randomBytes(IV_BYTES);
  const plaintext = encoder.encode(JSON.stringify(value));
  const ciphertext = await subtle().encrypt(
    { name: "AES-GCM", iv, additionalData: rowAad(profileId, table, rowKey) },
    key,
    plaintext,
  );
  await db.privateRows.put({
    id: profileRowId(profileId, table, rowKey),
    profileId,
    table,
    rowKey,
    version: CACHE_VERSION,
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
    updatedAt: new Date().toISOString(),
  });
  return true;
}

export async function deletePrivateValue(
  table: string,
  rowKey: string,
  db: LocalLibraryDatabase = localDb,
): Promise<void> {
  const profileId = activeCacheProfileId();
  if (profileId === null) return;
  await db.privateRows.delete(profileRowId(profileId, table, rowKey));
}

/** Read and decrypt one private value. Returns undefined when the row is absent. */
export async function getPrivateValue<T>(
  table: string,
  rowKey: string,
  db: LocalLibraryDatabase = localDb,
): Promise<T | undefined> {
  const profileId = activeCacheProfileId();
  if (profileId === null) return undefined;
  const key = activeKeys.get(profileId);
  if (!key) return undefined;

  const row = await db.privateRows.get(profileRowId(profileId, table, rowKey));
  if (!row) return undefined;
  const plaintext = await subtle().decrypt(
    {
      name: "AES-GCM",
      iv: fromBase64(row.iv),
      additionalData: rowAad(row.profileId, row.table, row.rowKey),
    },
    key,
    fromBase64(row.ciphertext),
  );
  return JSON.parse(decoder.decode(plaintext)) as T;
}

/**
 * Cache the private fields carried by the library payload.
 *
 * The shared metadata stays in `ReplicaBook`; only these values move into
 * encrypted rows. Called after every successful online library refresh, so a
 * later offline session has the same progress and favourites it last saw.
 */
export async function cacheLibraryPrivateState(
  books: { id: number; progress?: BookProgress | null }[],
  db: LocalLibraryDatabase = localDb,
): Promise<void> {
  const profileId = activeCacheProfileId();
  if (profileId === null) return;
  for (const book of books) {
    if (book.progress) {
      await putPrivateValue("progress", String(book.id), book.progress, db);
    } else {
      await deletePrivateValue("progress", String(book.id), db);
    }
  }
}

export async function cacheProgress(
  bookId: number,
  progress: BookProgress,
  db: LocalLibraryDatabase = localDb,
): Promise<boolean> {
  return putPrivateValue("progress", String(bookId), progress, db);
}

export async function readProgress(
  bookId: number,
  db: LocalLibraryDatabase = localDb,
): Promise<BookProgress | undefined> {
  return getPrivateValue<BookProgress>("progress", String(bookId), db);
}

export async function cacheFavourites(
  ids: number[],
  db: LocalLibraryDatabase = localDb,
): Promise<boolean> {
  return putPrivateValue("favourites", "ids", ids, db);
}

export async function readFavourites(
  db: LocalLibraryDatabase = localDb,
): Promise<number[] | undefined> {
  return getPrivateValue<number[]>("favourites", "ids", db);
}

export async function cacheWishlist(
  items: WishlistItem[],
  db: LocalLibraryDatabase = localDb,
): Promise<boolean> {
  return putPrivateValue("wishlist", "items", items, db);
}

export async function readWishlist(
  db: LocalLibraryDatabase = localDb,
): Promise<WishlistItem[] | undefined> {
  return getPrivateValue<WishlistItem[]>("wishlist", "items", db);
}
