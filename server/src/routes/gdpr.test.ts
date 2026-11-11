import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../app";
import { createTestDatabase } from "../test-support/database";

const db = createTestDatabase("audiobook-gdpr-test-");

let app: Awaited<ReturnType<typeof buildApp>>;
let prisma: PrismaClient;
let profileId: number;
let bookId: number;
let historyId: number;

beforeAll(async () => {
  prisma = new PrismaClient();
  const root = await prisma.libraryRoot.create({ data: { path: "/gdpr-test-root", label: "test" } });
  const profile = await prisma.profile.create({ data: { name: "gdpr-tester", role: "member" } });
  profileId = profile.id;
  const book = await prisma.mediaItem.create({
    data: {
      title: "A GDPR Book",
      author: "An Author",
      filePath: "/gdpr-test-root/book.mp3",
      fileFormat: "mp3",
      libraryRootId: root.id,
    },
  });
  bookId = book.id;
  const entry = await prisma.listeningHistory.create({
    data: { profileId, mediaItemId: bookId, position: 42, completed: false },
  });
  historyId = entry.id;
  app = await buildApp({ logger: false, prisma });
}, 120_000);

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  db.cleanup();
});

describe("the GDPR rights surface", () => {
  it("exports the caller's data without secrets", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/me/export",
      headers: { "x-profile-id": String(profileId) },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { profile: { id: number }; listeningHistory: Array<Record<string, unknown>> };
    expect(body.profile.id).toBe(profileId);
    expect(body.listeningHistory.length).toBe(1);
    expect(JSON.stringify(body)).not.toContain("tokenHash");
    expect(JSON.stringify(body)).not.toContain("passwordHash");
  });

  it("corrects the caller's name and colour", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/api/me",
      headers: { "x-profile-id": String(profileId) },
      payload: { name: "GDPR Corrected", color: "teal" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: profileId, name: "GDPR Corrected", color: "teal" });
  });

  it("deletes one listening-history entry", async () => {
    const response = await app.inject({
      method: "DELETE",
      url: `/api/me/listening-history/${historyId}`,
      headers: { "x-profile-id": String(profileId) },
    });
    expect(response.statusCode).toBe(204);
    const gone = await prisma.listeningHistory.findUnique({ where: { id: historyId } });
    expect(gone).toBeNull();
  });

  it("deletes one favourite", async () => {
    await prisma.favourite.create({ data: { profileId, mediaItemId: bookId } });
    const response = await app.inject({
      method: "DELETE",
      url: `/api/me/favourites/${bookId}`,
      headers: { "x-profile-id": String(profileId) },
    });
    expect(response.statusCode).toBe(204);
    const gone = await prisma.favourite.findUnique({
      where: { profileId_mediaItemId: { profileId, mediaItemId: bookId } },
    });
    expect(gone).toBeNull();
  });

  it("erases the caller's account and data", async () => {
    // Fresh profile so other tests are untouched.
    const profile = await prisma.profile.create({ data: { name: "gdpr-erase-me", role: "member" } });
    const response = await app.inject({
      method: "DELETE",
      url: "/api/me",
      headers: { "x-profile-id": String(profile.id) },
    });
    expect(response.statusCode).toBe(204);
    const gone = await prisma.profile.findUnique({ where: { id: profile.id } });
    expect(gone).toBeNull();
  });
});
