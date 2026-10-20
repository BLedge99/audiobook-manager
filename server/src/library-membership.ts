/**
 * Spec 27 — per-profile library membership.
 *
 * The server holds every book it has ever scanned. A **profile** holds a
 * subset of those, and this module is the only place that knows how the two
 * relate.
 *
 * ## The two kinds of profile
 *
 * | Kind | `followsServerLibrary` | Library |
 * |------|------------------------|---------|
 * | Existing when the feature shipped | `true` | every book, and every book scanned later |
 * | Created afterwards | `false` | nothing, until someone adds something |
 *
 * That asymmetry is the spec's decision, and it is deliberately one-sided:
 * shipping the feature must not change anything for a household that already
 * has the app, while a profile created later is a fresh start.
 *
 * **Removing a book does not clear the flag.** "Archie should not have that
 * one book" is not "Archie should stop getting new books" — those are two
 * different requests, and conflating them would silently change what the
 * household means.
 *
 * ## Why a membership row and not a copy
 *
 * A membership is a *row*. The audio file stays exactly where it is, in the
 * library root, and two profiles can hold the same book. Only the download to
 * a device is per device, and that was already true.
 */
import type { PrismaClient } from "@prisma/client";

/**
 * The rows that make up a profile's library.
 *
 * Used as the `where` clause on the library query, so a profile with no
 * membership rows genuinely sees nothing — the empty state is real, not a
 * special case.
 */
export function libraryEntriesFor(profileId: number) {
  return { libraryEntries: { some: { profileId } } };
}

/**
 * Add a book to a profile's library.
 *
 * Idempotent: adding a book a profile already has is not an error, it is a
 * no-op. The unique constraint on `(profileId, mediaItemId)` is what makes
 * that true, and the check-then-create is what keeps it true without relying
 * on a catch.
 */
export async function addBookToProfile(
  prisma: PrismaClient,
  profileId: number,
  mediaItemId: number,
): Promise<boolean> {
  const existing = await prisma.profileLibraryEntry.findUnique({
    where: { profileId_mediaItemId: { profileId, mediaItemId } },
    select: { id: true },
  });
  if (existing) return false;
  await prisma.profileLibraryEntry.create({ data: { profileId, mediaItemId } });
  return true;
}

/**
 * Remove a book from a profile's library.
 *
 * Idempotent in the same way: removing a book the profile does not have is
 * not an error.
 *
 * The book stays on the server. The server library is a property of the
 * filesystem, not of any profile, and a book removed from every profile simply
 * appears in nobody's shelf.
 */
export async function removeBookFromProfile(
  prisma: PrismaClient,
  profileId: number,
  mediaItemId: number,
): Promise<boolean> {
  const existing = await prisma.profileLibraryEntry.findUnique({
    where: { profileId_mediaItemId: { profileId, mediaItemId } },
    select: { id: true },
  });
  if (!existing) return false;
  await prisma.profileLibraryEntry.delete({ where: { id: existing.id } });
  return true;
}

/**
 * Give a profile every book the server has.
 *
 * Used by the migration (as SQL) and by the profile seeding, so the two can
 * never disagree about what "every book" means.
 */
export async function giveProfileEveryBook(prisma: PrismaClient, profileId: number): Promise<number> {
  const books = await prisma.mediaItem.findMany({ select: { id: true } });
  if (!books.length) return 0;
  const existing = await prisma.profileLibraryEntry.findMany({
    where: { profileId },
    select: { mediaItemId: true },
  });
  const have = new Set(existing.map((row) => row.mediaItemId));
  const missing = books.filter((book) => !have.has(book.id));
  if (!missing.length) return 0;
  await prisma.profileLibraryEntry.createMany({
    data: missing.map((book) => ({ profileId, mediaItemId: book.id })),
  });
  return missing.length;
}

/**
 * Add a newly scanned book to every profile that follows the server library.
 *
 * Called from the scanner. A profile that follows gets new books without
 * anyone touching it; a curated profile does not, because the household
 * curated it on purpose.
 */
export async function addBookToFollowingProfiles(
  prisma: PrismaClient,
  mediaItemId: number,
): Promise<number> {
  const followers = await prisma.profile.findMany({
    where: { followsServerLibrary: true },
    select: { id: true },
  });
  if (!followers.length) return 0;
  const existing = await prisma.profileLibraryEntry.findMany({
    where: { mediaItemId, profileId: { in: followers.map((profile) => profile.id) } },
    select: { profileId: true },
  });
  const have = new Set(existing.map((row) => row.profileId));
  const missing = followers.filter((profile) => !have.has(profile.id));
  if (!missing.length) return 0;
  await prisma.profileLibraryEntry.createMany({
    data: missing.map((profile) => ({ profileId: profile.id, mediaItemId })),
  });
  return missing.length;
}
