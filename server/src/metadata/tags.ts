import type { PrismaClient } from "@prisma/client";
import { normalizeText } from "./types";

/**
 * Spec 18 — the custom tag vocabulary.
 *
 * Tags are a *managed* household-wide list, not free text. Creating a tag once
 * and assigning it is what prevents the "great"/"GREAT"/"good" sprawl that a
 * per-book free-text field invites.
 */

/**
 * Words the client uses as routes or tab names. A tag with one of these names
 * would be indistinguishable from the feature itself in the UI, so they are
 * rejected outright rather than silently shadowed.
 */
export const RESERVED_TAG_NAMES = new Set([
  "all",
  "favourites",
  "favorites",
  "discover",
  "wishlist",
  "genres",
  "authors",
  "narrators",
  "series",
  "library",
  "browse",
  "tags",
]);

/** Long enough to be a real tag, short enough to render on a chip. */
const MIN_TAG_LENGTH = 1;
const MAX_TAG_LENGTH = 40;

export type TagNameError =
  | "empty"
  | "too-long"
  | "reserved"
  | "collides-with-genre"
  | "invalid-characters";

export interface TagNameValidation {
  ok: boolean;
  name?: string;
  key?: string;
  reason?: TagNameError;
}

/** Characters allowed in a tag name. Restrictive on purpose. */
const INVALID_CHARACTERS = /[<>{}[\]\\/]/;

export function validateTagName(name: string): { name: string; key: string } | { reason: TagNameError } {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed) return { reason: "empty" };
  if (trimmed.length > MAX_TAG_LENGTH) return { reason: "too-long" };
  if (INVALID_CHARACTERS.test(trimmed)) return { reason: "invalid-characters" };
  if (RESERVED_TAG_NAMES.has(trimmed.toLowerCase())) return { reason: "reserved" };
  return { name: trimmed, key: normalizeText(trimmed) };
}

/**
 * Validate a tag name against the live genre vocabulary.
 *
 * A tag that duplicates a genre name would produce two identically-named
 * entries in the same filter bar, so it is refused (409) rather than merged.
 */
export async function validateTagNameWithGenres(
  prisma: PrismaClient,
  name: string,
): Promise<TagNameValidation> {
  const base = validateTagName(name);
  if ("reason" in base) return { ok: false, reason: base.reason };

  // Compare against normalised genre *names*, not slugs: a slug uses hyphens
  // ("mystery-thriller") while normalizeText produces spaces, so comparing
  // the two would never match and the collision check would be dead code.
  const genres = await prisma.genre.findMany({ select: { name: true } });
  if (genres.some((genre) => normalizeText(genre.name) === base.key)) {
    return { ok: false, reason: "collides-with-genre" };
  }

  return { ok: true, name: base.name, key: base.key };
}

/**
 * Create a tag, or return the existing one if the name is already taken.
 *
 * Idempotent by normalised name so two household members racing to create
 * "cosy" get one tag rather than a 500 on the unique index.
 */
export async function createTag(
  prisma: PrismaClient,
  name: string,
  createdBy?: number | null,
): Promise<{ tag: { id: number; name: string }; created: boolean } | { reason: TagNameError }> {
  const validation = await validateTagNameWithGenres(prisma, name);
  if (!validation.ok) return { reason: validation.reason! };

  const existing = await prisma.tag.findUnique({ where: { key: validation.key! } });
  if (existing) return { tag: existing, created: false };

  const tag = await prisma.tag.create({
    data: { name: validation.name!, key: validation.key!, createdBy: createdBy ?? null },
  });
  return { tag, created: true };
}

/** Rename a tag, keeping every assignment. */
export async function renameTag(
  prisma: PrismaClient,
  tagId: number,
  name: string,
): Promise<{ tag: { id: number; name: string } } | { reason: TagNameError }> {
  const validation = await validateTagNameWithGenres(prisma, name);
  if (!validation.ok) return { reason: validation.reason! };

  const existing = await prisma.tag.findUnique({ where: { key: validation.key! } });
  // Renaming to a different id's name would violate the unique key.
  if (existing && existing.id !== tagId) return { reason: "reserved" };

  const tag = await prisma.tag.update({ where: { id: tagId }, data: { name: validation.name! } });
  return { tag };
}

/**
 * Merge `sourceTagId` into `targetTagId`.
 *
 * Required rather than optional: without it a household slowly accumulates
 * near-duplicate tags and the browse UI becomes useless. Every assignment moves
 * and the count is reported so the caller can confirm.
 */
export async function mergeTags(
  prisma: PrismaClient,
  sourceTagId: number,
  targetTagId: number,
): Promise<{ moved: number; deleted: boolean } | { reason: "not-found" | "same-tag" }> {
  if (sourceTagId === targetTagId) return { reason: "same-tag" };

  const [source, target] = await Promise.all([
    prisma.tag.findUnique({ where: { id: sourceTagId } }),
    prisma.tag.findUnique({ where: { id: targetTagId } }),
  ]);
  if (!source || !target) return { reason: "not-found" };

  const assignments = await prisma.mediaItemTag.findMany({ where: { tagId: sourceTagId } });

  let moved = 0;
  for (const assignment of assignments) {
    const alreadyTagged = await prisma.mediaItemTag.findUnique({
      where: { mediaItemId_tagId: { mediaItemId: assignment.mediaItemId, tagId: targetTagId } },
    });
    if (alreadyTagged) {
      // The book already has the target tag; just drop the duplicate link.
      await prisma.mediaItemTag.delete({
        where: { mediaItemId_tagId: { mediaItemId: assignment.mediaItemId, tagId: sourceTagId } },
      });
    } else {
      await prisma.mediaItemTag.update({
        where: { mediaItemId_tagId: { mediaItemId: assignment.mediaItemId, tagId: sourceTagId } },
        data: { tagId: targetTagId },
      });
      moved += 1;
    }
  }

  await prisma.tag.delete({ where: { id: sourceTagId } });
  return { moved, deleted: true };
}

/** Replace a book's custom tags wholesale. */
export async function setBookTags(
  prisma: PrismaClient,
  mediaItemId: number,
  tagIds: number[],
): Promise<number> {
  await prisma.mediaItemTag.deleteMany({ where: { mediaItemId } });
  if (tagIds.length === 0) return 0;
  await prisma.mediaItemTag.createMany({
    data: tagIds.map((tagId) => ({ mediaItemId, tagId })),
  });
  return tagIds.length;
}