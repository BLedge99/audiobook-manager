import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { applyChapterTitles, parseTrackTitleOverrides, resolveTrackTitle, trackTitleOverrideField } from "./chapters";
import type { ProviderChapter } from "./types";

/**
 * Spec 21 — chapter titles against a real database.
 *
 * The unit tests cover the matching rules. What cannot be tested without a
 * database is the acceptance criterion that actually shipped broken: "a
 * user-set track title is never overwritten". `applyChapterTitles` declared a
 * `lockedTrackIds` option that no caller ever passed, so the guarantee was
 * enforced by nothing. These tests exist so that regression fails loudly.
 */

const dir = mkdtempSync(path.join(tmpdir(), "audiobook-chapters-"));
const dbFile = path.join(dir, "test.db");

let prisma: PrismaClient;
let libraryRootId = 0;
let nextBook = 0;

beforeAll(async () => {
  if (!process.env.DATABASE_URL?.startsWith("file:")) {
    process.env.DATABASE_URL = `file:${dbFile}`;
  }
  const schemaFlag = `--schema "${path.join(__dirname, "..", "..", "prisma", "schema.test.prisma")}"`;
  execSync(`npx prisma db push --accept-data-loss ${schemaFlag}`.trim(), {
    cwd: path.join(__dirname, "..", ".."),
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL! },
    stdio: "ignore",
  });
  prisma = new PrismaClient();
  const root = await prisma.libraryRoot.create({ data: { path: "/lib", label: "Test" } });
  libraryRootId = root.id;
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

/** A three-file book with placeholder embedded titles. */
async function makeBook() {
  nextBook += 1;
  const item = await prisma.mediaItem.create({
    data: {
      libraryRootId,
      filePath: `/lib/book-${nextBook}`,
      title: `Book ${nextBook}`,
      author: "Unknown",
      fileFormat: "mp3",
      duration: 300,
    },
  });
  for (let n = 1; n <= 3; n += 1) {
    await prisma.track.create({
      data: {
        mediaItemId: item.id,
        filePath: `/lib/book-${nextBook}/track-${n}.mp3`,
        title: `Section 0${n}`,
        duration: 100,
        trackNumber: n,
      },
    });
  }
  return item;
}

const chapters: ProviderChapter[] = [
  { title: "Chapters I-V", fileName: "track-1.mp3" },
  { title: "Chapters VI-IX", fileName: "track-2.mp3" },
  { title: "Chapters X-XIV", fileName: "track-3.mp3" },
];

/**
 * What the `PUT /tracks/:n/title` endpoint does: record the override *and*
 * write the title, in that order. Tests that set up a locked track by hand
 * must do both, or they assert against a state the app can never be in.
 */
async function setUserTitle(itemId: number, trackNumber: number, title: string) {
  await prisma.fieldOverride.create({
    data: { mediaItemId: itemId, field: trackTitleOverrideField(trackNumber), value: title },
  });
  const track = await prisma.track.findFirstOrThrow({ where: { mediaItemId: itemId, trackNumber } });
  await prisma.track.update({ where: { id: track.id }, data: { title } });
}

async function titles(itemId: number): Promise<string[]> {
  const tracks = await prisma.track.findMany({
    where: { mediaItemId: itemId },
    orderBy: { trackNumber: "asc" },
  });
  return tracks.map((track) => track.title ?? "");
}

describe("applyChapterTitles", () => {
  it("replaces placeholders with official names", async () => {
    const item = await makeBook();
    const changed = await applyChapterTitles(prisma, item.id, chapters);
    expect(changed).toBe(3);
    expect(await titles(item.id)).toEqual(["Chapters I-V", "Chapters VI-IX", "Chapters X-XIV"]);
  });

  it("leaves a user-set title alone", async () => {
    const item = await makeBook();
    // Mirror the real write path: the endpoint records the override and writes
    // the title in one go, and the scanner re-applies it on every rescan.
    await setUserTitle(item.id, 2, "My Own Name");

    const changed = await applyChapterTitles(prisma, item.id, chapters);

    // The two unlocked tracks still improve; the locked one is untouched.
    expect(changed).toBe(2);
    expect(await titles(item.id)).toEqual(["Chapters I-V", "My Own Name", "Chapters X-XIV"]);
  });

  it("never replaces a user title with a *better* provider title", async () => {
    // Deliberately the opposite of the usual preference: the user's title is
    // longer and more descriptive than the provider's. The lock still wins,
    // because it is the user's choice and not a quality judgement.
    const item = await makeBook();
    await setUserTitle(item.id, 1, "The Tell-Tale Heart, Read Aloud");
    await applyChapterTitles(prisma, item.id, [{ title: "Opening", fileName: "track-1.mp3" }, ...chapters.slice(1)]);
    expect((await titles(item.id))[0]).toBe("The Tell-Tale Heart, Read Aloud");
  });

  // Rewriting every already-correct track title on each run would bump
  // `updatedAt` on rows that had not changed.
  it("is idempotent -- a second pass writes nothing", async () => {
    const item = await makeBook();
    await applyChapterTitles(prisma, item.id, chapters);
    const before = await titles(item.id);

    const second = await applyChapterTitles(prisma, item.id, chapters);

    expect(second).toBe(0);
    expect(await titles(item.id)).toEqual(before);
  });

  it("is a no-op for a book with no tracks", async () => {
    const item = await prisma.mediaItem.create({
      data: { libraryRootId, filePath: "/lib/empty", title: "Empty", author: "Unknown", fileFormat: "mp3", duration: 0 },
    });
    expect(await applyChapterTitles(prisma, item.id, chapters)).toBe(0);
  });
});

/**
 * The scanner deletes and recreates every track row on each rescan, so the
 * override has to be re-applied from `FieldOverride` at create time. Without
 * that, a hand-set chapter name survives enrichment but is wiped by the next
 * scan -- which would make the guarantee above cosmetic.
 */
describe("overrides survive a track recreation", () => {
  it("rebuilds track titles from the override rows", async () => {
    const item = await makeBook();
    await prisma.fieldOverride.create({
      data: { mediaItemId: item.id, field: trackTitleOverrideField(3), value: "Hand Written" },
    });

    // Mimic exactly what the scanner does.
    await prisma.track.deleteMany({ where: { mediaItemId: item.id } });
    const overrides = parseTrackTitleOverrides(
      await prisma.fieldOverride.findMany({
        where: { mediaItemId: item.id, field: { startsWith: "trackTitle:" } },
        select: { field: true, value: true },
      }),
    );
    for (let n = 1; n <= 3; n += 1) {
      await prisma.track.create({
        data: {
          mediaItemId: item.id,
          filePath: `/lib/book-${nextBook}/track-${n}.mp3`,
          title: resolveTrackTitle(n, `Section 0${n}`, overrides),
          duration: 100,
          trackNumber: n,
        },
      });
    }

    expect(await titles(item.id)).toEqual(["Section 01", "Section 02", "Hand Written"]);
  });
});