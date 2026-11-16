import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { buildApp, SESSION_HEADER } from "../app";
import { hashPassword } from "../auth/password";
import { hashSessionToken, newSessionId, newSessionToken } from "../auth/session";
import { createTestDatabase } from "../test-support/database";

const db = createTestDatabase("audiobook-enrichment-gate-");

let app: Awaited<ReturnType<typeof buildApp>>;
let prisma: PrismaClient;
let bookId: number;

const asUser = (token: string) => ({ [SESSION_HEADER]: token });

async function createAccount(name: string, role: "admin" | "member" | "child", ageBand: string | null = null) {
  const profile = await prisma.profile.create({
    data: {
      name: `${name}-${randomUUID().slice(0, 8)}`,
      role,
      ageBand,
      passwordHash: await hashPassword("pw-test"),
      passwordUpdatedAt: new Date(),
    },
  });
  const token = newSessionToken();
  await prisma.session.create({
    data: {
      id: newSessionId(),
      tokenHash: hashSessionToken(token),
      profileId: profile.id,
      via: "profile",
      userAgent: "gate-test",
      deviceLabel: "gate-test",
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  return { id: profile.id, token };
}

beforeAll(async () => {
  prisma = new PrismaClient();
  const root = await prisma.libraryRoot.create({ data: { path: "/enrichment-gate-root", label: "gate" } });
  const book = await prisma.mediaItem.create({
    data: {
      title: "Gate Book",
      author: "Some Author",
      filePath: "/enrichment-gate-root/book.mp3",
      fileFormat: "mp3",
      libraryRootId: root.id,
    },
  });
  bookId = book.id;
  app = await buildApp({ logger: false, appPassword: "household", mediaTokenSecret: "m".repeat(32), prisma });
}, 120_000);

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  db.cleanup();
});

describe("POST /api/enrichment/run authorization", () => {
  it("forbids a child profile from triggering enrichment", async () => {
    const kid = await createAccount("kid", "child", "10-13");
    const res = await app.inject({
      method: "POST",
      url: "/api/enrichment/run",
      headers: asUser(kid.token),
      payload: { mediaItemId: bookId },
    });
    expect(res.statusCode).toBe(403);
  });

  it("forbids a member from triggering a catalogue-wide forced pass", async () => {
    const member = await createAccount("member", "member");
    const res = await app.inject({
      method: "POST",
      url: "/api/enrichment/run",
      headers: asUser(member.token),
      payload: { force: true },
    });
    expect(res.statusCode).toBe(403);
  });

  it("forbids a member from triggering enrichment at all (operator endpoint)", async () => {
    const member = await createAccount("member2", "member");
    const res = await app.inject({
      method: "POST",
      url: "/api/enrichment/run",
      headers: asUser(member.token),
      payload: { mediaItemId: bookId },
    });
    expect(res.statusCode).toBe(403);
  });

  it("allows an admin to trigger enrichment", async () => {
    const admin = await createAccount("admin", "admin");
    const res = await app.inject({
      method: "POST",
      url: "/api/enrichment/run",
      headers: asUser(admin.token),
      payload: { mediaItemId: bookId },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("GET /api/enrichment/status authorization", () => {
  it("hides household-wide enrichment state from children", async () => {
    const kid = await createAccount("kid-status", "child", "10-13");
    const res = await app.inject({ method: "GET", url: "/api/enrichment/status", headers: asUser(kid.token) });
    expect(res.statusCode).toBe(403);
  });

  it("shows it to admins only (it is an operator surface)", async () => {
    // isAdminRoute gates /api/enrichment/* to operators: the household notice is
    // hidden from members and children alike (client tolerates the 403).
    const member = await createAccount("member-status", "member");
    const admin = await createAccount("admin-status", "admin");
    expect(
      (await app.inject({ method: "GET", url: "/api/enrichment/status", headers: asUser(member.token) })).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: "GET", url: "/api/enrichment/status", headers: asUser(admin.token) })).statusCode,
    ).toBe(200);
  });
});

describe("production boot fails closed without APP_PASSWORD", () => {
  it("throws instead of booting an unauthenticated family app", async () => {
    const saved = process.env.NODE_ENV;
    const savedPassword = process.env.APP_PASSWORD;
    process.env.NODE_ENV = "production";
    delete process.env.APP_PASSWORD;
    try {
      await buildApp({ logger: false, prisma });
      expect.unreachable("buildApp must not boot without APP_PASSWORD in production");
    } catch (error) {
      expect(String((error as Error).stack)).toMatch(/APP_PASSWORD/);
    } finally {
      process.env.NODE_ENV = saved;
      if (savedPassword !== undefined) process.env.APP_PASSWORD = savedPassword;
    }
  });
});
