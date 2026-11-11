import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../app";
import { createTestDatabase } from "../test-support/database";

const db = createTestDatabase("audiobook-progress-test-");

let app: Awaited<ReturnType<typeof buildApp>>;
let prisma: PrismaClient;
let profileId: number;
let bookId: number;

beforeAll(async () => {
  prisma = new PrismaClient();
  const profile = await prisma.profile.create({ data: { name: "progress-tester", role: "member" } });
  profileId = profile.id;
  const root = await prisma.libraryRoot.create({ data: { path: "/progress-test-root", label: "test" } });
  const book = await prisma.mediaItem.create({
    data: {
      title: "A Progress Book",
      author: "An Author",
      filePath: "/progress-test-root/book.mp3",
      fileFormat: "mp3",
      libraryRootId: root.id,
      duration: 600,
    },
  });
  bookId = book.id;
  app = await buildApp({ logger: false, prisma });
}, 120_000);

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  db.cleanup();
});

describe("progress", () => {
  it("reads zero by default", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/audiobooks/${bookId}/progress`,
      headers: { "x-profile-id": String(profileId) },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ position: 0, completed: false });
  });

  it("writes and clamps position", async () => {
    const response = await app.inject({
      method: "PUT",
      url: `/api/audiobooks/${bookId}/progress`,
      headers: { "x-profile-id": String(profileId) },
      payload: { position: 10_000 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ position: 600, completed: true });

    const readBack = await app.inject({
      method: "GET",
      url: `/api/audiobooks/${bookId}/progress`,
      headers: { "x-profile-id": String(profileId) },
    });
    expect(readBack.json()).toEqual({ position: 600, completed: true });
  });

  it("404s for an unknown book", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/audiobooks/999999/progress",
      headers: { "x-profile-id": String(profileId) },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("play sessions and history", () => {
  it("records a session", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/audiobooks/${bookId}/sessions`,
      headers: { "x-profile-id": String(profileId) },
      payload: { fromPosition: 10, toPosition: 300, speed: 1.5 },
    });
    expect(response.statusCode).toBe(201);
    const session = response.json() as { toPosition: number; speed: number };
    expect(session.toPosition).toBe(300);
    expect(session.speed).toBe(1.5);
  });

  it("rejects missing positions", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/audiobooks/${bookId}/sessions`,
      headers: { "x-profile-id": String(profileId) },
      payload: {},
    });
    expect(response.statusCode).toBe(400);
  });

  it("lists history without a profile id field", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/history",
      headers: { "x-profile-id": String(profileId) },
    });
    expect(response.statusCode).toBe(200);
    const sessions = response.json() as Array<Record<string, unknown>>;
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions[0]).not.toHaveProperty("profileId");
  });
});
