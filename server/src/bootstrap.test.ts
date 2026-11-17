import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "./app";
import { createTestDatabase } from "./test-support/database";

/**
 * Fresh-install bootstrap (specs/03, decisions/038 — no shipped profiles).
 *
 * 1. The server seeds nothing: a brand new database has zero profiles.
 * 2. The first profile created in the app becomes the household admin and
 *    follows the server library (it sees every book that exists at that
 *    moment, and new ones as they are scanned in).
 * 3. Every later profile is a plain member with an empty shelf.
 */

const db = createTestDatabase("audiobook-bootstrap-");

let prisma: PrismaClient;
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  prisma = new PrismaClient();
  app = await buildApp({ logger: false, appPassword: "household", prisma });
}, 120_000);

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  db.cleanup();
});

beforeEach(async () => {
  await prisma.profileLibraryEntry.deleteMany();
  await prisma.profile.deleteMany();
  await prisma.track.deleteMany();
  await prisma.mediaItem.deleteMany();
  await prisma.libraryRoot.deleteMany();
});

async function seedBook(title: string) {
  const root =
    (await prisma.libraryRoot.findFirst()) ??
    (await prisma.libraryRoot.create({ data: { path: "/lib", label: "Test" } }));
  const item = await prisma.mediaItem.create({
    data: {
      libraryRootId: root.id,
      filePath: `/lib/bootstrap-${Date.now()}-${title}`,
      title,
      author: "Unknown",
      fileFormat: "mp3",
      duration: 300,
    },
  });
  await prisma.track.create({
    data: {
      mediaItemId: item.id,
      filePath: `/lib/bootstrap-${item.id}/track-1.mp3`,
      title: "Section 01",
      duration: 300,
      trackNumber: 1,
      sizeBytes: 12_345_678n,
    },
  });
  return item;
}

async function register(name: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/register-profile",
    payload: { name, householdPassword: "household", password: "own-password-82" },
  });
  expect(res.statusCode).toBe(200);
  return res.json<{ profile: { id: number; name: string } }>().profile;
}

describe("fresh install bootstrap", () => {
  it("ships with no preset profiles", async () => {
    expect(await prisma.profile.count()).toBe(0);
  });

  it("first registered profile becomes admin and follows the server library", async () => {
    await seedBook("Book A");
    await seedBook("Book B");

    const first = await register("whoever-sets-it-up");
    const profile = await prisma.profile.findUniqueOrThrow({ where: { id: first.id } });
    expect(profile.role).toBe("admin");
    expect(profile.followsServerLibrary).toBe(true);

    const shelved = await prisma.profileLibraryEntry.count({ where: { profileId: first.id } });
    expect(shelved).toBe(2);
  });

  it("later profiles are plain members with an empty shelf", async () => {
    await seedBook("Book A");
    await seedBook("Book B");

    await register("first-person");
    const second = await register("second-person");
    const profile = await prisma.profile.findUniqueOrThrow({ where: { id: second.id } });
    expect(profile.role).toBe("member");
    expect(profile.followsServerLibrary).toBe(false);

    const shelved = await prisma.profileLibraryEntry.count({ where: { profileId: second.id } });
    expect(shelved).toBe(0);
  });
});
