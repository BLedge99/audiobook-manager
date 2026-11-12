import type { PrismaClient } from "@prisma/client";
import { blockedGenreIds } from "./blocklist";
import { andVisibility, visibilityWhere } from "./visibility";
import { canProfileSeeBook, type AgeContext } from "./policy";
import { maxAgeForBand } from "./bands";

/**
 * Spec 38 / ADR 033 — the DB-backed inputs every enforcement point shares.
 *
 * `ageContextFor` resolves the caller's role + age band (fetched once); a
 * child session without a profile — impossible today, defended anyway —
 * fails closed to the strictest band.
 *
 * `visibleForAge` is the single answer to "may this caller see this book on
 * age grounds?" — it resolves the role from the session when the session
 * knows it, and from the profile row otherwise (a media token in a query
 * string carries no role). Non-children always may.
 */

export async function ageContextFor(
  prisma: PrismaClient,
  role: string | undefined,
  profileId: number | null,
): Promise<AgeContext> {
  if (role !== "child") return { role: role ?? "member", ageBand: null };
  if (profileId == null) return { role: "child", ageBand: null }; // fail closed
  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    select: { ageBand: true },
  });
  return { role: "child", ageBand: profile?.ageBand ?? null };
}

export interface BookAgeFacts {
  minimumAge: number | null;
  genreIds: number[];
}

export async function loadBookAgeFacts(
  prisma: PrismaClient,
  mediaItemId: number,
): Promise<BookAgeFacts | null> {
  const item = await prisma.mediaItem.findUnique({
    where: { id: mediaItemId },
    select: { minimumAge: true, genres: { select: { genreId: true } } },
  });
  if (!item) return null;
  return { minimumAge: item.minimumAge, genreIds: item.genres.map((genre) => genre.genreId) };
}

export async function visibleForAge(
  prisma: PrismaClient,
  sessionRole: string | undefined,
  profileId: number | null,
  mediaItemId: number,
): Promise<boolean> {
  let ctx: AgeContext;
  if (sessionRole === undefined && profileId !== null) {
    // A media-token request may carry a profile but no role — read it from the profile.
    const profile = await prisma.profile.findUnique({
      where: { id: profileId },
      select: { role: true, ageBand: true },
    });
    if (!profile) return false;
    ctx = { role: profile.role, ageBand: profile.ageBand };
  } else {
    ctx = await ageContextFor(prisma, sessionRole, profileId);
  }
  if (ctx.role !== "child") return true;
  const [blocked, facts] = await Promise.all([
    blockedGenreIds(prisma),
    loadBookAgeFacts(prisma, mediaItemId),
  ]);
  if (!facts) return false;
  return canProfileSeeBook(ctx, facts, blocked);
}

/**
 * The MediaItem `where` a child's own rows are scoped by: their shelf ∩ the
 * age gate. `null` for non-children, so callers can use it unconditionally.
 */
export async function visibleItemScope(
  prisma: PrismaClient,
  role: string | undefined,
  profileId: number | null,
): Promise<Record<string, unknown> | null> {
  const ctx = await ageContextFor(prisma, role, profileId);
  if (ctx.role !== "child") return null;
  const blocked = await blockedGenreIds(prisma);
  const scope = visibilityWhere(ctx, blocked)!;
  if (profileId === null) return scope as unknown as Record<string, unknown>;
  return andVisibility({ libraryEntries: { some: { profileId } } }, scope);
}

/** Inputs for the Discover service: the ceiling and the blocklist as ids. */
export async function childDiscoverFilter(
  prisma: PrismaClient,
  role: string | undefined,
  profileId: number | null,
): Promise<{ maxAge: number; blockedGenreIds: number[] } | undefined> {
  const ctx = await ageContextFor(prisma, role, profileId);
  if (ctx.role !== "child") return undefined;
  const blocked = await blockedGenreIds(prisma);
  return { maxAge: maxAgeForBand(ctx.ageBand), blockedGenreIds: [...blocked] };
}
