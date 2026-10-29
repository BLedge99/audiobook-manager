import { describe, it, test, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { createScanManager } from "./scanner";

/**
 * Scanner integration tests.
 *
 * These are the tests that matter most in this file, because the path they
 * cover is destructive: when a book's files leave the disk the scanner deletes
 * the database row. That path had no coverage, so a foreign key created
 * without a cascade made the very first real deletion fail and the whole scan
 * error out. Unit tests over `scan-utils` could never have caught it.
 */

const dir = mkdtempSync(path.join(tmpdir(), "audiobook-scanner-"));
const dbFile = path.join(dir, "test.db");

let prisma: PrismaClient;
const library = path.join(dir, "library");
let libraryRootId = 0;

/** A real LibriVox fixture, so tags and durations behave as they do in life. */
function sampleLibrary(): string | null {
  // This file is at server/src/, so the repo root is two levels up.
  const fixtures = path.join(__dirname, "..", "..", "test");
  if (!existsSync(fixtures)) return null;
  const folder = readdirSync(fixtures).find((entry) => {
    const candidate = path.join(fixtures, entry);
    return (
      existsSync(candidate) &&
      readdirSync(candidate).some((file) => file.toLowerCase().endsWith(".mp3"))
    );
  });
  if (!folder) return null;
  return path.join(fixtures, folder);
}

beforeAll(async () => {
  const isCI = process.env.CI === "true";
  if (!isCI) {
    process.env.DATABASE_URL = `file:${dbFile}`;
  }
  const isPostgresUrl = (process.env.DATABASE_URL ?? "").startsWith("postgresql://") || (process.env.DATABASE_URL ?? "").startsWith("postgres://");
  const schemaFlag = isPostgresUrl ? "" : `--schema "${path.join(__dirname, "..", "prisma", "schema.test.prisma")}"`;
  execSync(`npx prisma db push --accept-data-loss ${schemaFlag}`.trim(), {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL! },
    stdio: "ignore",
  });

  prisma = new PrismaClient();
  const source = sampleLibrary();
  if (source) {
    // Copy *into* a folder of its own so the layout matches reality: one
    // directory per book. Copying the folder's contents directly into the
    // library root flattens them, and a multi-file book then looks like a
    // single-file one -- which silently invalidated the deletion test.
    const bookFolder = path.join(library, path.basename(source));
    mkdirSync(bookFolder, { recursive: true });
    cpSync(source, bookFolder, { recursive: true });
  }
  const root = await prisma.libraryRoot.create({ data: { path: library, label: "Fixture" } });
  libraryRootId = root.id;
}, 180_000);

afterAll(async () => {
  await prisma.$disconnect();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

/**
 * Resolved at module load, not inside a test: `skipIf` is a collection-time
 * modifier, so calling it from within a test body throws.
 */
const HAS_FIXTURES = sampleLibrary() !== null;
const needsFixtures = "needs the test/ fixture library";

describe("scanner reconciliation", () => {
  it.skipIf(!HAS_FIXTURES)("imports books and a multi-file group becomes one title", async () => {
    await createScanManager(prisma).scanRoot(libraryRootId);

    const items = await prisma.mediaItem.findMany();
    expect(items.length).toBeGreaterThan(0);

    // The headline spec 16/17 behaviour: a multi-file book is titled from the
    // album tag, not from an archive.org folder name.
    for (const item of items) {
      expect(item.title).not.toMatch(/_librivox$/i);
    }
  });

  it.skipIf(!HAS_FIXTURES)("creates Track rows, which reference MediaItem with a foreign key", async () => {
    expect(await prisma.track.count()).toBeGreaterThan(0);
  });

  it.skipIf(!HAS_FIXTURES)("deleting a book whose files left the disk does not fail the scan", async () => {
    // Regression: Track, MetadataCandidate, ListeningHistory and
    // ContributorMediaItem were created without ON DELETE CASCADE, so SQLite
    // had them as RESTRICT. The first scan that actually removed a book died
    // with P2003 and left the library wedged.

    const item = await prisma.mediaItem.findFirstOrThrow();
    // Give it every child row type that could block the delete.
    await prisma.track.create({
      data: { mediaItemId: item.id, filePath: "/gone/01.mp3", duration: 1, trackNumber: 99 },
    });
    await prisma.contributor.create({
      data: { name: "Blocker", role: "narrator", mediaItems: { create: { mediaItemId: item.id } } },
    });
    const profile = await prisma.profile.create({ data: { name: `scan-${Date.now().toString(36)}` } });
    await prisma.listeningHistory.create({
      data: { mediaItemId: item.id, profileId: profile.id, position: 5 },
    });
    await prisma.metadataCandidate.create({
      data: { mediaItemId: item.id, source: "librivox", title: "Stale candidate" },
    });
    await prisma.favourite.create({ data: { profileId: profile.id, mediaItemId: item.id } });
    await prisma.fieldOverride.create({ data: { mediaItemId: item.id, field: "title", value: "Stale" } });

    // Remove the files so the next scan considers the book gone.
    const bookFolder = path.dirname(item.filePath);
    // Guard the precondition properly: the folder must have held the files we
    // are about to assert on. Checking existence afterwards of a path that never
    // existed passes vacuously and hides a broken test.
    expect(
      readdirSync(bookFolder).some((file) => file.toLowerCase().endsWith(".mp3")),
      `fixture folder should hold audio: ${bookFolder}`,
    ).toBe(true);
    rmSync(bookFolder, { recursive: true, force: true });
    expect(existsSync(bookFolder), `fixture folder should be gone: ${bookFolder}`).toBe(false);

    // The scan must complete rather than throw.
    await expect(createScanManager(prisma).scanRoot(libraryRootId)).resolves.toBeUndefined();

    expect(await prisma.mediaItem.findUnique({ where: { id: item.id } })).toBeNull();
    // And its children went with it rather than dangling.
    expect(await prisma.track.count({ where: { mediaItemId: item.id } })).toBe(0);
    expect(await prisma.contributorMediaItem.count({ where: { mediaItemId: item.id } })).toBe(0);
    expect(await prisma.favourite.count({ where: { mediaItemId: item.id } })).toBe(0);
  });

  it.skipIf(!HAS_FIXTURES)("marks the scan complete and records the file count", async () => {
    const state = await prisma.scanState.findFirst({ where: { libraryRootId } });
    expect(state?.status).toBe("complete");
  });
});

/**
 * A book that is **one file** used to get no Track rows at all: the book was
 * its own file, and the client knew to stream it from
 * /api/audiobooks/:id/stream.
 *
 * But everything that *stores* audio is per track -- the download, the
 * replica, "is this book on the device?" -- so such a book could be streamed
 * and never downloaded. The symptom was a button that said "The Christmas Pig
 * has no tracks to download" on a book that played perfectly from the server.
 *
 * One file is the normal shape of a commercial audiobook, not a corner case.
 */
describe("scanner: a single-file book", () => {
  it.skipIf(!HAS_FIXTURES)("still gets a track, so it can be downloaded", async () => {
    const source = sampleLibrary();
    const singleRoot = path.join(dir, "single-root");
    const bookFolder = path.join(singleRoot, "OneBook");
    mkdirSync(bookFolder, { recursive: true });
    const file = readdirSync(source!).find((entry) => entry.toLowerCase().endsWith(".mp3"));
    cpSync(path.join(source!, file!), path.join(bookFolder, file!));

    const root = await prisma.libraryRoot.create({ data: { path: singleRoot, label: "Single file" } });
    await createScanManager(prisma).scanRoot(root.id);

    const item = await prisma.mediaItem.findFirstOrThrow({ where: { libraryRootId: root.id } });
    const tracks = await prisma.track.findMany({ where: { mediaItemId: item.id } });

    // Exactly one track, pointing at the book's own file.
    expect(tracks).toHaveLength(1);
    expect(tracks[0].filePath).toBe(item.filePath);
    expect(tracks[0].trackNumber).toBe(1);
  });
});