import { maxAgeForBand } from "./bands";

/**
 * Spec 38 / ADR 033 — the one age predicate.
 *
 * Every enforcement point in the server calls this (or `visibilityWhere`,
 * the Prisma `where` fragment built from it) rather than re-deriving the
 * rule at the call site — the spec-37 finding is that rules which only one
 * caller holds get re-imposed, slightly differently.
 *
 * Order of checks is deliberate:
 *   1. non-children see everything;
 *   2. the household genre blocklist hides a book from every child band,
 *      regardless of rating;
 *   3. an unrated book is visible (the catalogue starts unrated);
 *   4. otherwise the book's minimumAge must fit the child's band ceiling.
 */

export interface AgeContext {
  role: string;
  ageBand: string | null;
}

export interface BookAgeFacts {
  /** Confirmed admin-set rating; null = unrated = visible. */
  minimumAge: number | null;
  /** Genre ids the book carries (the blocklist keys on ids, not slugs). */
  genreIds: number[];
}

export function canProfileSeeBook(
  caller: AgeContext,
  book: BookAgeFacts,
  blockedGenreIds: ReadonlySet<number>,
): boolean {
  if (caller.role !== "child") return true;
  for (const id of book.genreIds) {
    if (blockedGenreIds.has(id)) return false;
  }
  if (book.minimumAge == null) return true;
  return book.minimumAge <= maxAgeForBand(caller.ageBand);
}
