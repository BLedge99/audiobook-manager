import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../app";
import { createTestDatabase } from "../test-support/database";
import { imageExtensionFromBytes } from "../metadata/cover";

/**
 * Acceptance tests for the 2026-11-16 hardening pass: input validation at the
 * edge, erasure wired to the declarative personal-data table, and no absolute
 * server paths in family-app responses.
 */
const db = createTestDatabase("audiobook-hardening-test-");

let app: Awaited<ReturnType<typeof buildApp>>;
let prisma: PrismaClient;
let bookId: number;
let rootId: number;
let sessionProfileId: number = 0;

beforeAll(async () => {
  prisma = new PrismaClient();
  const root = await prisma.libraryRoot.create({ data: { path: "/hardening-test-root", label: "hardening" } });
  rootId = root.id;
  const book = await prisma.mediaItem.create({
    data: {
      title: "Hardening Book",
      author: "Some Author",
      filePath: "/hardening-test-root/book.mp3",
      fileFormat: "mp3",
      libraryRootId: root.id,
    },
  });
  bookId = book.id;
  const profile = await prisma.profile.create({ data: { name: "hardening-tester", role: "member" } });
  sessionProfileId = profile.id;
  app = await buildApp({ logger: false, prisma });
}, 120_000);

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  db.cleanup();
});

describe("POST /api/profiles input validation", () => {
  it("rejects a missing name", async () => {
    const res = await app.inject({ method: "POST", url: "/api/profiles", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an overlong name", async () => {
    const res = await app.inject({ method: "POST", url: "/api/profiles", payload: { name: "x".repeat(200) } });
    expect(res.statusCode).toBe(400);
  });

  it("silently drops undeclared properties instead of mass-assigning them", async () => {
    // Fastify's ajv strips additional properties — a client cannot smuggle
    // role:"admin" onto a profile create.
    const res = await app.inject({ method: "POST", url: "/api/profiles", payload: { name: "Ok-Mass", role: "admin" } });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ role: string }>().role).not.toBe("admin");
  });
});

describe("DELETE /api/profiles/:id", () => {
  it("400s on an unparseable id instead of a 500", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/profiles/not-a-number" });
    expect(res.statusCode).toBe(400);
  });

  it("erases the profile's personal data, not just the profile row", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/profiles",
      payload: { name: `erase-${Date.now()}` },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json<{ id: number }>().id;
    await prisma.favourite.create({ data: { profileId: id, mediaItemId: bookId } });
    await prisma.playSession.create({ data: { mediaItemId: bookId, profileId: id, fromPosition: 0, toPosition: 30, startedAt: new Date() } });

    const res = await app.inject({ method: "DELETE", url: `/api/profiles/${id}` });
    expect(res.statusCode).toBe(204);
    expect(await prisma.profile.findUnique({ where: { id } })).toBeNull();
    expect(await prisma.favourite.count({ where: { profileId: id } })).toBe(0);
    expect(await prisma.playSession.count({ where: { profileId: id } })).toBe(0);
  });
});

describe("play sessions input validation", () => {
  it("rejects an unparseable startedAt", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/audiobooks/${bookId}/sessions`,
      headers: { "x-profile-id": String(sessionProfileId) },
      payload: { fromPosition: 0, toPosition: 10, startedAt: "not a date" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an unparseable endedAt", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/audiobooks/${bookId}/sessions`,
      headers: { "x-profile-id": String(sessionProfileId) },
      payload: { fromPosition: 0, toPosition: 10, endedAt: "31/02/2026" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("accepts ISO dates", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/audiobooks/${bookId}/sessions`,
      headers: { "x-profile-id": String(sessionProfileId) },
      payload: { fromPosition: 0, toPosition: 10, startedAt: "2026-11-16T10:00:00.000Z", endedAt: "2026-11-16T10:05:00.000Z" },
    });
    expect(res.statusCode, res.body).toBe(201);
  });
});

describe("no absolute server paths in family-app responses", () => {
  it("GET /api/scan/status omits root paths", async () => {
    const res = await app.inject({ method: "GET", url: "/api/scan/status" });
    expect(res.statusCode).toBe(200);
    const body = res.json<Array<Record<string, unknown>>>();
    const entry = body.find((row) => row.rootId === rootId);
    expect(entry).toBeDefined();
    expect(entry).not.toHaveProperty("path");
  });

  it("GET /api/library-roots omits root paths", async () => {
    const res = await app.inject({ method: "GET", url: "/api/library-roots" });
    expect(res.statusCode).toBe(200);
    const body = res.json<Array<Record<string, unknown>>>();
    const entry = body.find((row) => row.id === rootId);
    expect(entry).toBeDefined();
    expect(entry).not.toHaveProperty("path");
  });
});

describe("embedded cover extension is derived from bytes, not tags", () => {
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]);

  it("maps magic bytes to a whitelisted extension", () => {
    expect(imageExtensionFromBytes(JPEG)).toBe("jpg");
    expect(imageExtensionFromBytes(PNG)).toBe("png");
    expect(imageExtensionFromBytes(WEBP)).toBe("webp");
  });

  it("returns null for unrecognised bytes (never an attacker-chosen extension)", () => {
    expect(imageExtensionFromBytes(Buffer.from("<html>x</html>"))).toBeNull();
    expect(imageExtensionFromBytes(Buffer.alloc(0))).toBeNull();
  });
});

describe("GET /api/discover/similar/:id querystring", () => {
  it("accepts a limit parameter it does not read (back-compat)", async () => {
    const res = await app.inject({ method: "GET", url: `/api/discover/similar/${bookId}?limit=20` });
    expect(res.statusCode).toBe(200);
  });
});
