import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  createTag,
  mergeTags,
  renameTag,
  setBookTags,
  validateTagName,
  validateTagNameWithGenres,
  RESERVED_TAG_NAMES,
} from "./tags";
import { seedGenres } from "./taxonomy-service";

/**
 * Spec 18 — favourites & custom tag vocabulary.
 *
 * The behaviours that matter here are isolation (one profile's favourites must
 * not leak into another's), idempotency, and merge reassigning every
 * assignment -- all of which are relational, so a real database is required.
 */

const dir = mkdtempSync(path.join(tmpdir(), "audiobook-tags-"));
const dbFile = path.join(dir, "test.db");

let prisma: PrismaClient;
let libraryRootId = 0;
let nextBook = 0;
const profiles: number[] = [];

beforeAll(async () => {
  const isCI = process.env.CI === "true";
  if (!isCI) {
    process.env.DATABASE_URL = `file:${dbFile}`;
  }
  const isPostgresUrl = (process.env.DATABASE_URL ?? "").startsWith("postgresql://") || (process.env.DATABASE_URL ?? "").startsWith("postgres://");
  const schemaFlag = isPostgresUrl ? "" : `--schema "${path.join(__dirname, "..", "..", "prisma", "schema.test.prisma")}"`;
  execSync(`npx prisma db push --accept-data-loss ${schemaFlag}`.trim(), {
    cwd: path.join(__dirname, "..", ".."),
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL! },
    stdio: "ignore",
  });
  prisma = new PrismaClient();
  await seedGenres(prisma);
  const root = await prisma.libraryRoot.create({ data: { path: "/lib", label: "Test" } });
  libraryRootId = root.id;
  for (const name of ["Dad", "Mum", "Archie"]) {
    const profile = await prisma.profile.create({ data: { name } });
    profiles.push(profile.id);
  }
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

async function makeBook(title: string) {
  nextBook += 1;
  return prisma.mediaItem.create({
    data: {
      libraryRootId,
      title,
      author: "Author",
      filePath: `/lib/${nextBook}/${title}.mp3`,
      fileFormat: "mp3",
    },
  });
}

describe("favourites", () => {
  it("adds a favourite for a profile", async () => {
    const book = await makeBook(`Fav ${nextBook + 1}`);
    const fav = await prisma.favourite.create({ data: { profileId: profiles[0], mediaItemId: book.id } });
    expect(fav.profileId).toBe(profiles[0]);
  });

  it("does not leak one profile's favourites to another", async () => {
    const book = await makeBook(`Isolated ${nextBook + 1}`);
    await prisma.favourite.create({ data: { profileId: profiles[0], mediaItemId: book.id } });

    const forMum = await prisma.favourite.findMany({ where: { profileId: profiles[1] } });
    expect(forMum.some((row) => row.mediaItemId === book.id)).toBe(false);
  });

  it("lets two profiles favourite the same book independently", async () => {
    const book = await makeBook(`Shared ${nextBook + 1}`);
    await prisma.favourite.create({ data: { profileId: profiles[0], mediaItemId: book.id } });
    await prisma.favourite.create({ data: { profileId: profiles[1], mediaItemId: book.id } });

    expect(await prisma.favourite.count({ where: { mediaItemId: book.id } })).toBe(2);
  });

  it("is idempotent - the same profile cannot favourite twice", async () => {
    const book = await makeBook(`Idempotent ${nextBook + 1}`);
    await prisma.favourite.create({ data: { profileId: profiles[0], mediaItemId: book.id } });
    // The unique constraint is what makes this safe under a double-tap.
    await expect(
      prisma.favourite.create({ data: { profileId: profiles[0], mediaItemId: book.id } }),
    ).rejects.toThrow();
    expect(await prisma.favourite.count({ where: { profileId: profiles[0], mediaItemId: book.id } })).toBe(1);
  });

  it("un-favouriting a book that is not favourited is a no-op", async () => {
    const book = await makeBook(`Not Fav ${nextBook + 1}`);
    const { count } = await prisma.favourite.deleteMany({
      where: { profileId: profiles[2], mediaItemId: book.id },
    });
    expect(count).toBe(0);
  });

  it("cascades a deleted book away from favourites", async () => {
    const book = await makeBook(`Doomed ${nextBook + 1}`);
    await prisma.favourite.create({ data: { profileId: profiles[0], mediaItemId: book.id } });
    await prisma.mediaItem.delete({ where: { id: book.id } });
    expect(await prisma.favourite.count({ where: { mediaItemId: book.id } })).toBe(0);
  });
});

describe("validateTagName", () => {
  it("accepts an ordinary name", () => {
    expect(validateTagName("cosy")).toEqual({ name: "cosy", key: "cosy" });
  });

  it("trims and collapses whitespace", () => {
    expect(validateTagName("  long   commute  ")).toEqual({ name: "long commute", key: "long commute" });
  });

  it("rejects an empty name", () => {
    expect(validateTagName("   ")).toEqual({ reason: "empty" });
  });

  it("rejects an over-long name", () => {
    expect(validateTagName("x".repeat(60))).toEqual({ reason: "too-long" });
  });

  it("rejects reserved route names", () => {
    for (const reserved of RESERVED_TAG_NAMES) {
      expect(validateTagName(reserved)).toEqual({ reason: "reserved" });
      // Case must not smuggle a reserved word past the check.
      expect(validateTagName(reserved.toUpperCase())).toEqual({ reason: "reserved" });
    }
  });

  it("rejects path and markup characters", () => {
    expect(validateTagName("../etc")).toEqual({ reason: "invalid-characters" });
    expect(validateTagName("<script>")).toEqual({ reason: "invalid-characters" });
  });
});

describe("validateTagNameWithGenres", () => {
  it("rejects a name that collides with a genre", async () => {
    // Normalisation must handle the `&` -> space difference: the genre is
    // "Mystery & Thriller" and the slug is "mystery-thriller", neither of
    // which matches the tag key "mystery thriller" without normalising both.
    const result = await validateTagNameWithGenres(prisma, "Mystery & Thriller");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("collides-with-genre");
  });

  it("rejects a genre name regardless of case", async () => {
    const result = await validateTagNameWithGenres(prisma, "science fiction");
    expect(result.reason).toBe("collides-with-genre");
  });

  it("accepts a name that is not a genre", async () => {
    const result = await validateTagNameWithGenres(prisma, "bedtime");
    expect(result.ok).toBe(true);
  });
});

describe("createTag", () => {
  it("creates a new tag", async () => {
    const result = await createTag(prisma, "cosy");
    expect("created" in result && result.created).toBe(true);
  });

  it("is idempotent for an existing name", async () => {
    const first = await createTag(prisma, "commute");
    const second = await createTag(prisma, "commute");
    if (!("tag" in first) || !("tag" in second)) throw new Error("expected tags");
    expect(first.tag.id).toBe(second.tag.id);
    expect(second.created).toBe(false);
  });

  it("treats case variants as the same tag", async () => {
    await createTag(prisma, "Sleep");
    const again = await createTag(prisma, "sleep");
    expect("created" in again && again.created).toBe(false);
  });

  it("rejects a reserved name", async () => {
    expect(await createTag(prisma, "discover")).toEqual({ reason: "reserved" });
  });
});

describe("renameTag", () => {
  it("renames a tag and keeps its assignments", async () => {
    const created = await createTag(prisma, "rename-me");
    if (!("tag" in created)) throw new Error("expected a tag");
    const book = await makeBook(`Rename ${nextBook + 1}`);
    await setBookTags(prisma, book.id, [created.tag.id]);

    const renamed = await renameTag(prisma, created.tag.id, "renamed");
    expect("tag" in renamed && renamed.tag.name).toBe("renamed");
    expect(await prisma.mediaItemTag.count({ where: { tagId: created.tag.id } })).toBe(1);
  });

  it("refuses to rename onto another tag's name", async () => {
    const first = await createTag(prisma, `rename-keep-${nextBook + 1}`);
    const second = await createTag(prisma, `rename-take-${nextBook + 1}`);
    if (!("tag" in first) || !("tag" in second)) throw new Error("expected tags");

    // Renaming onto a live tag's name would violate the unique key; it is
    // refused as a conflict rather than silently merging the two.
    const result = await renameTag(prisma, second.tag.id, first.tag.name);
    expect("reason" in result).toBe(true);
    expect(await prisma.tag.findUnique({ where: { id: second.tag.id } })).not.toBeNull();
  });

  it("rejects renaming to a reserved name", async () => {
    const created = await createTag(prisma, `rename-reserved-${nextBook + 1}`);
    if (!("tag" in created)) throw new Error("expected tag");
    expect(await renameTag(prisma, created.tag.id, "wishlist")).toEqual({ reason: "reserved" });
  });
});

describe("mergeTags", () => {
  async function tagPair() {
    const source = await createTag(prisma, `merge-src-${nextBook + 1}`);
    const target = await createTag(prisma, `merge-dst-${nextBook + 1}`);
    if (!("tag" in source) || !("tag" in target)) throw new Error("expected tags");
    return { sourceId: source.tag.id, targetId: target.tag.id };
  }

  it("moves every assignment to the target", async () => {
    const { sourceId, targetId } = await tagPair();
    const books = [await makeBook(`M1 ${nextBook + 1}`), await makeBook(`M2 ${nextBook + 1}`)];
    for (const book of books) await setBookTags(prisma, book.id, [sourceId]);

    const result = await mergeTags(prisma, sourceId, targetId);
    expect(result).toMatchObject({ moved: 2, deleted: true });
    for (const book of books) {
      expect(await prisma.mediaItemTag.count({ where: { mediaItemId: book.id, tagId: targetId } })).toBe(1);
      expect(await prisma.mediaItemTag.count({ where: { mediaItemId: book.id, tagId: sourceId } })).toBe(0);
    }
  });

  it("deletes the source tag", async () => {
    const { sourceId, targetId } = await tagPair();
    await mergeTags(prisma, sourceId, targetId);
    expect(await prisma.tag.findUnique({ where: { id: sourceId } })).toBeNull();
    expect(await prisma.tag.findUnique({ where: { id: targetId } })).not.toBeNull();
  });

  it("de-duplicates a book that already had the target tag", async () => {
    const { sourceId, targetId } = await tagPair();
    const book = await makeBook(`Dup ${nextBook + 1}`);
    await setBookTags(prisma, book.id, [sourceId, targetId]);

    // The book already had the target, so it is not "moved" -- the duplicate
    // source link is simply dropped.
    const result = await mergeTags(prisma, sourceId, targetId);
    expect(result).toMatchObject({ moved: 0 });
    expect(await prisma.mediaItemTag.count({ where: { mediaItemId: book.id } })).toBe(1);
  });

  it("refuses to merge a tag into itself", async () => {
    const { sourceId } = await tagPair();
    expect(await mergeTags(prisma, sourceId, sourceId)).toEqual({ reason: "same-tag" });
  });

  it("reports not-found for an unknown tag", async () => {
    const { targetId } = await tagPair();
    expect(await mergeTags(prisma, 999_998, targetId)).toEqual({ reason: "not-found" });
  });
});

describe("setBookTags", () => {
  it("replaces the book's tags wholesale", async () => {
    const a = await createTag(prisma, `set-a-${nextBook + 1}`);
    const b = await createTag(prisma, `set-b-${nextBook + 1}`);
    if (!("tag" in a) || !("tag" in b)) throw new Error("expected tags");
    const book = await makeBook(`Set ${nextBook + 1}`);

    await setBookTags(prisma, book.id, [a.tag.id, b.tag.id]);
    expect(await prisma.mediaItemTag.count({ where: { mediaItemId: book.id } })).toBe(2);

    await setBookTags(prisma, book.id, [b.tag.id]);
    const remaining = await prisma.mediaItemTag.findMany({ where: { mediaItemId: book.id } });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].tagId).toBe(b.tag.id);
  });

  it("clears all tags with an empty list", async () => {
    const a = await createTag(prisma, `clear-a-${nextBook + 1}`);
    if (!("tag" in a)) throw new Error("expected tag");
    const book = await makeBook(`Clear ${nextBook + 1}`);
    await setBookTags(prisma, book.id, [a.tag.id]);
    await setBookTags(prisma, book.id, []);
    expect(await prisma.mediaItemTag.count({ where: { mediaItemId: book.id } })).toBe(0);
  });
});

describe("tag counts agree with the listed books", () => {
  it("a tag's count equals its assignment count", async () => {
    const created = await createTag(prisma, `counted-${nextBook + 1}`);
    if (!("tag" in created)) throw new Error("expected tag");
    const books = [await makeBook(`C1 ${nextBook + 1}`), await makeBook(`C2 ${nextBook + 1}`)];
    for (const book of books) await setBookTags(prisma, book.id, [created.tag.id]);

    const listed = await prisma.tag.findUnique({
      where: { id: created.tag.id },
      include: { _count: { select: { items: true } } },
    });
    expect(listed?._count.items).toBe(2);
    expect(
      await prisma.mediaItemTag.count({ where: { tagId: created.tag.id } }),
    ).toBe(listed?._count.items);
  });
});