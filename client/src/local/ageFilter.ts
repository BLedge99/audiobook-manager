/**
 * Spec 38 — the offline half of the age gate.
 *
 * The server filters everything online. Offline, the device replica is the
 * library, so it must apply the same ladder to what it renders. Two honest
 * limits, documented in LIMITATIONS.md:
 *
 *  - the household genre blocklist cannot be evaluated offline (the device
 *    does not carry the blocklist); the rating ladder is what applies;
 *  - a download made before a book was re-rated persists until the next
 *    refresh re-evaluates it.
 *
 * The online gate remains the authority; this mirrors the same ladder, and
 * fails closed on unknown bands like the server.
 */
import type { Audiobook } from "../types";

export const AGE_BAND_MAX: Readonly<Record<string, number>> = {
  "under-6": 5,
  "6-9": 9,
  "10-13": 13,
  "14-17": 17,
};

export const STRICTEST_MAX_AGE = 5;

export function offlineMaxAge(ageBand: string | null | undefined): number {
  return (ageBand && ageBand in AGE_BAND_MAX) ? AGE_BAND_MAX[ageBand] : STRICTEST_MAX_AGE;
}

export function bookVisibleOffline(
  book: { minimumAge?: number | null },
  maxAge: number,
): boolean {
  return book.minimumAge == null || book.minimumAge <= maxAge;
}

export function filterBooksForKids<T extends { minimumAge?: number | null }>(
  books: T[],
  role: string | null | undefined,
  ageBand: string | null | undefined,
): T[] {
  if (role !== "child") return books;
  const maxAge = offlineMaxAge(ageBand);
  return books.filter((book) => bookVisibleOffline(book, maxAge));
}

/** Convenience for Audiobook rows. */
export function filterDeviceBooks(
  books: Audiobook[],
  role: string | null | undefined,
  ageBand: string | null | undefined,
): Audiobook[] {
  return filterBooksForKids(books, role, ageBand);
}
