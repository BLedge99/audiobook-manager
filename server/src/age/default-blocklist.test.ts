/**
 * Spec 38 — the default blocklist seed.
 *
 * Seeded once per installation. An empty blocklist stays empty (an admin who
 * removed everything deliberately), a pre-populated blocklist is never
 * clobbered, and a missing taxonomy costs a retry, never a marker burn.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createTestDatabase } from "../test-support/database";
import { DEFAULT_BLOCKLIST_SLUGS, seedDefaultBlocklist } from "./default-blocklist";

const db = createTestDatabase("audiobook-default-blocklist-");

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = new PrismaClient();
});

afterAll(async () => {
  await prisma.$disconnect();
  db.cleanup();
});

async function seedTaxonomy() {
  await prisma.genre.createMany({
    data: [
      { slug: "erotica", name: "Erotica" },
      { slug: "horror", name: "Horror" },
      { slug: "true-crime", name: "True Crime" },
      { slug: "cozy", name: "Cozy" },
    ],
  });
}

describe("seedDefaultBlocklist (spec 38)", () => {
  it("is a no-op with no genres, and does not burn the marker", async () => {
    expect(await seedDefaultBlocklist(prisma)).toBe(0);
    expect(await prisma.genreBlocklistSeed.count()).toBe(0);
  });

  it("seeds the three default genres and writes the marker", async () => {
    await seedTaxonomy();
    expect(await seedDefaultBlocklist(prisma)).toBe(3);
    const slugs = (await prisma.blocklistGenre.findMany({ include: { genre: true } })).map((row) => row.genre.slug);
    expect(slugs.sort()).toEqual([...DEFAULT_BLOCKLIST_SLUGS].sort());
    expect(await prisma.genreBlocklistSeed.findUnique({ where: { id: 1 } })).not.toBeNull();
  });

  it("never seeds twice, even on an empty blocklist", async () => {
    // Admin empties the blocklist deliberately.
    await prisma.blocklistGenre.deleteMany();
    expect(await seedDefaultBlocklist(prisma)).toBe(0);
    expect(await prisma.blocklistGenre.count()).toBe(0);
  });

  it("never clobbers a pre-populated blocklist, only writes the marker", async () => {
    await prisma.blocklistGenre.deleteMany();
    await prisma.genreBlocklistSeed.deleteMany();
    const genre = await prisma.genre.findFirstOrThrow({ where: { slug: "cozy" } });
    await prisma.blocklistGenre.create({ data: { genreId: genre.id } });

    expect(await seedDefaultBlocklist(prisma)).toBe(0);
    const slugs = (await prisma.blocklistGenre.findMany({ include: { genre: true } })).map((row) => row.genre.slug);
    expect(slugs).toEqual(["cozy"]);
    // Marker is written so it never tries again with a stale expectation.
    expect(await prisma.genreBlocklistSeed.findUnique({ where: { id: 1 } })).not.toBeNull();
  });
});
