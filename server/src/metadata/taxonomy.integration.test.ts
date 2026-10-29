import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  mapGenreString,
  applyGenres,
  reconcileContributors,
  seedGenreMappings,
  seedGenres,
  upsertSeries,
} from "./taxonomy-service";

/**
 * Spec 17 — taxonomy service integration tests.
 *
 * These need a real SQLite database because the behaviour under test *is* the
 * relational behaviour: mapping fallbacks, contributor reconciliation, and
 * user-vs-provider genre precedence.
 */

const dir = mkdtempSync(path.join(tmpdir(), "audiobook-taxonomy-"));
const dbFile = path.join(dir, "test.db");
// Matches the temp-SQLite pattern used by the other integration suites.
const dbUrl = `file:${dbFile}`;

let prisma: PrismaClient;
let libraryRootId = 0;

beforeAll(async () => {
  const isCI = process.env.CI === "true";
  if (!isCI) {
    process.env.DATABASE_URL = dbUrl;
    const isPostgresUrl = (process.env.DATABASE_URL ?? "").startsWith("postgresql://") || (process.env.DATABASE_URL ?? "").startsWith("postgres://");
    const schemaFlag = isPostgresUrl ? "" : `--schema "${path.join(__dirname, "..", "..", "prisma", "schema.test.prisma")}"`;
    execSync(`npx prisma db push --accept-data-loss ${schemaFlag}`.trim(), {
      // This file lives in src/metadata/, so the server root is two levels up.
      cwd: path.join(__dirname, "..", ".."),
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL! },
      stdio: "ignore",
    });
  }
  prisma = new PrismaClient();
  await seedGenres(prisma);
  await seedGenreMappings(prisma);
  const root = await prisma.libraryRoot.create({ data: { path: "/test/library", label: "Test" } });
  libraryRootId = root.id;
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  // Windows keeps a handle on the SQLite file briefly; a failed cleanup must
  // not fail the suite.
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

async function makeBook(title = "Dune") {
  return prisma.mediaItem.create({
    data: {
      libraryRootId,
      title,
      author: "Frank Herbert",
      filePath: `/lib/${title}/${title}.mp3`,
      fileFormat: "mp3",
    },
  });
}

describe("genre seeding", () => {
  it("creates the top-level and child genres", async () => {
    const count = await prisma.genre.count();
    expect(count).toBeGreaterThan(30);
  });

  it("is idempotent - a second seed does not duplicate", async () => {
    const before = await prisma.genre.count();
    await seedGenres(prisma);
    await seedGenreMappings(prisma);
    expect(await prisma.genre.count()).toBe(before);
  });

  it("provides exactly one catch-all bucket", async () => {
    expect(await prisma.genre.count({ where: { isCatchAll: true } })).toBe(1);
  });
});

describe("mapGenreString", () => {
  it("maps an exact provider string", async () => {
    const genreId = await mapGenreString(prisma, "audnexus", "Science Fiction");
    expect(genreId).not.toBeNull();
    const genre = await prisma.genre.findUnique({ where: { id: genreId! } });
    expect(genre?.slug).toBe("science-fiction");
  });

  it("matches case-insensitively", async () => {
    const lower = await mapGenreString(prisma, "audnexus", "science fiction");
    const upper = await mapGenreString(prisma, "audnexus", "SCIENCE FICTION");
    expect(lower).toBe(upper);
  });

  it("matches a longer Audnexus string by containment", async () => {
    const genreId = await mapGenreString(prisma, "audnexus", "Mystery, Thriller & Suspense");
    const genre = await prisma.genre.findUnique({ where: { id: genreId! } });
    expect(genre?.slug).toBe("mystery-thriller");
  });

  it("falls back to the catch-all bucket for an unmapped string", async () => {
    const genreId = await mapGenreString(prisma, "audnexus", "Underwater Basket Weaving");
    const genre = await prisma.genre.findUnique({ where: { id: genreId! } });
    expect(genre?.isCatchAll).toBe(true);
  });

  it("returns the catch-all when the provider has no mappings at all", async () => {
    const genreId = await mapGenreString(prisma, "unknownprovider", "Anything");
    const genre = await prisma.genre.findUnique({ where: { id: genreId! } });
    expect(genre?.isCatchAll).toBe(true);
  });

  it("lets an operator-corrected mapping win", async () => {
    await prisma.genreMapping.upsert({
      where: { provider_rawValue: { provider: "audnexus", rawValue: "Underwater Basket Weaving" } },
      create: { provider: "audnexus", rawValue: "Underwater Basket Weaving", genreId: (await prisma.genre.findUniqueOrThrow({ where: { slug: "science-fiction" } })).id },
      update: {},
    });
    const genreId = await mapGenreString(prisma, "audnexus", "Underwater Basket Weaving");
    const genre = await prisma.genre.findUnique({ where: { id: genreId! } });
    expect(genre?.slug).toBe("science-fiction");
  });
});

describe("applyGenres", () => {
  it("assigns mapped genres to a book", async () => {
    const book = await makeBook("Genre Book A");
    await applyGenres(prisma, book.id, "audnexus", ["Science Fiction", "Adventure"]);
    const rows = await prisma.mediaItemGenre.findMany({ where: { mediaItemId: book.id } });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.source === "provider")).toBe(true);
  });

  it("replaces stale provider genres on a re-apply", async () => {
    const book = await makeBook("Genre Book B");
    await applyGenres(prisma, book.id, "audnexus", ["Horror"]);
    await applyGenres(prisma, book.id, "audnexus", ["Romance"]);
    const rows = await prisma.mediaItemGenre.findMany({ where: { mediaItemId: book.id }, include: { genre: true } });
    expect(rows).toHaveLength(1);
    expect(rows[0].genre.slug).toBe("romance");
  });

  it("does not revoke a user-assigned genre", async () => {
    const book = await makeBook("Genre Book C");
    const horror = await prisma.genre.findUniqueOrThrow({ where: { slug: "horror" } });
    await prisma.mediaItemGenre.create({ data: { mediaItemId: book.id, genreId: horror.id, source: "user" } });

    // Provider re-apply with a different genre must leave the user's choice.
    await applyGenres(prisma, book.id, "audnexus", ["Romance"]);
    const rows = await prisma.mediaItemGenre.findMany({ where: { mediaItemId: book.id }, include: { genre: true } });
    const slugs = rows.map((row) => row.genre.slug);
    expect(slugs).toContain("horror");
    expect(slugs).toContain("romance");
  });

  it("is a no-op for an empty genre list", async () => {
    const book = await makeBook("Genre Book D");
    expect(await applyGenres(prisma, book.id, "audnexus", [])).toBe(0);
    expect(await prisma.mediaItemGenre.count({ where: { mediaItemId: book.id } })).toBe(0);
  });

  it("deduplicates genres that map to the same slug", async () => {
    const book = await makeBook("Genre Book E");
    await applyGenres(prisma, book.id, "audnexus", ["science fiction", "Science Fiction", "SCIENCE FICTION"]);
    expect(await prisma.mediaItemGenre.count({ where: { mediaItemId: book.id } })).toBe(1);
  });
});

describe("reconcileContributors", () => {
  it("adds author and narrators", async () => {
    const book = await makeBook("Contributor Book A");
    await reconcileContributors(prisma, book.id, [
      { name: "Frank Herbert", role: "author" },
      { name: "Simon Vance", role: "narrator" },
      { name: "Scott Brick", role: "narrator" },
    ]);
    const rows = await prisma.contributorMediaItem.findMany({
      where: { mediaItemId: book.id },
      include: { contributor: true },
    });
    expect(rows).toHaveLength(3);
  });

  it("removes contributors the new match does not have", async () => {
    const book = await makeBook("Contributor Book B");
    await reconcileContributors(prisma, book.id, [
      { name: "Author One", role: "author" },
      { name: "Old Narrator", role: "narrator" },
    ]);
    // Re-enrich against a different match.
    await reconcileContributors(prisma, book.id, [
      { name: "Author One", role: "author" },
      { name: "New Narrator", role: "narrator" },
    ]);

    const names = (await prisma.contributorMediaItem.findMany({
      where: { mediaItemId: book.id },
      include: { contributor: true },
    })).map((row) => row.contributor.name);

    // This is the spec 01 bug spec 17 fixes: "Old Narrator" used to persist.
    expect(names).not.toContain("Old Narrator");
    expect(names).toContain("New Narrator");
  });

  it("keeps the same person in two roles as two contributors", async () => {
    const book = await makeBook("Contributor Book C");
    await reconcileContributors(prisma, book.id, [
      { name: "Michael Ondaatje", role: "author" },
      { name: "Michael Ondaatje", role: "narrator" },
    ]);
    const rows = await prisma.contributorMediaItem.findMany({
      where: { mediaItemId: book.id },
      include: { contributor: true },
    });
    expect(rows).toHaveLength(2);
  });

  it("de-duplicates a repeated identical contributor", async () => {
    const book = await makeBook("Contributor Book D");
    const count = await reconcileContributors(prisma, book.id, [
      { name: "Repeat", role: "narrator" },
      { name: "Repeat", role: "narrator" },
      { name: "repeat", role: "narrator" },
    ]);
    expect(count).toBe(1);
  });

  it("ignores contributors with a blank name", async () => {
    const book = await makeBook("Contributor Book E");
    const count = await reconcileContributors(prisma, book.id, [
      { name: "   ", role: "narrator" },
      { name: "Real", role: "narrator" },
    ]);
    expect(count).toBe(1);
  });

  it("clears every contributor when the new match has none", async () => {
    const book = await makeBook("Contributor Book F");
    await reconcileContributors(prisma, book.id, [{ name: "Someone", role: "narrator" }]);
    await reconcileContributors(prisma, book.id, []);
    expect(await prisma.contributorMediaItem.count({ where: { mediaItemId: book.id } })).toBe(0);
  });

  it("does not delete the shared Contributor row when a book drops it", async () => {
    const book = await makeBook("Contributor Book G");
    await reconcileContributors(prisma, book.id, [{ name: "Shared Person", role: "narrator" }]);
    await reconcileContributors(prisma, book.id, []);
    // Contributor rows are shared across books; dropping a link must not
    // delete the row, or every other book loses the name.
    expect(await prisma.contributor.count({ where: { name: "Shared Person" } })).toBe(1);
  });
});

describe("upsertSeries", () => {
  it("creates a series", async () => {
    expect(await upsertSeries(prisma, "The Expanse")).not.toBeNull();
  });

  it("groups case and punctuation variants into one series", async () => {
    const first = await upsertSeries(prisma, "The Expanse");
    const second = await upsertSeries(prisma, "the expanse");
    const third = await upsertSeries(prisma, "The Expanse!");
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("keeps genuinely different series apart", async () => {
    const a = await upsertSeries(prisma, "Dune");
    const b = await upsertSeries(prisma, "Dune Messiah");
    expect(a).not.toBe(b);
  });

  it("returns null for a blank name", async () => {
    expect(await upsertSeries(prisma, "   ")).toBeNull();
    expect(await upsertSeries(prisma, "!!!")).toBeNull();
  });
});