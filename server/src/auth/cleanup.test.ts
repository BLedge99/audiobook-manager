import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { AuthService } from "./service";
import { hashSessionToken, newSessionId, newSessionToken } from "./session";
import { createTestDatabase } from "../test-support/database";
import { hashPassword } from "./password";

const db = createTestDatabase("audiobook-cleanup-test-");
const dir = db.dir;

let prisma: PrismaClient;
let auth: AuthService;

/** Fixed clock: 2026-01-01T00:00:00Z, advanced manually per test. */
let clock = new Date("2026-01-01T00:00:00.000Z");
const now = () => clock;

function advance(months: number) {
  clock = new Date(clock.getTime() + months * 30 * 24 * 60 * 60 * 1000);
}

async function createProfile(name: string, lastActiveAt: Date | null, createdAt: Date | null = null) {
  return prisma.profile.create({
    data: {
      name,
      passwordHash: await hashPassword("pw-" + name),
      passwordUpdatedAt: now(),
      lastActiveAt,
      createdAt: createdAt ?? now(),
    },
  });
}

async function createSession(profileId: number | null, expired: boolean, revoked: boolean) {
  const token = newSessionToken();
  await prisma.session.create({
    data: {
      id: newSessionId(),
      tokenHash: hashSessionToken(token),
      profileId,
      via: "profile",
      expiresAt: expired ? new Date(clock.getTime() - 1000) : new Date(clock.getTime() + 1000 * 60 * 60),
      revokedAt: revoked ? now() : null,
    },
  });
}

async function createDeviceCredential(profileId: number, expired: boolean, revoked: boolean) {
  await prisma.deviceCredential.create({
    data: {
      id: newSessionId(),
      profileId,
      secretHash: hashSessionToken(newSessionToken()),
      label: "Test Device",
      expiresAt: expired ? new Date(clock.getTime() - 1000) : new Date(clock.getTime() + 90 * 24 * 60 * 60 * 1000),
      revokedAt: revoked ? now() : null,
    },
  });
}

async function createWebAuthnChallenge(profileId: number | null, expired: boolean) {
  await prisma.webAuthnChallenge.create({
    data: {
      id: newSessionId(),
      profileId,
      challenge: newSessionToken(),
      type: "authentication",
      expiresAt: expired ? new Date(clock.getTime() - 1000) : new Date(clock.getTime() + 5 * 60 * 1000),
    },
  });
}

async function createAdminSession(expired: boolean, revoked: boolean) {
  await prisma.adminSession.create({
    data: {
      id: newSessionId(),
      tokenHash: hashSessionToken(newSessionToken()),
      expiresAt: expired ? new Date(clock.getTime() - 1000) : new Date(clock.getTime() + 1000 * 60 * 60),
      revokedAt: revoked ? now() : null,
    },
  });
}

let mediaItemSeq = 0;

async function createMediaItem(title: string): Promise<number> {
  mediaItemSeq += 1;
  let root = await prisma.libraryRoot.findUnique({ where: { path: "/test/cleanup" } });
  if (!root) {
    root = await prisma.libraryRoot.create({ data: { path: "/test/cleanup", label: "Cleanup Test Library" } });
  }
  const item = await prisma.mediaItem.create({
    data: { title, author: "Test Author", filePath: `/test/cleanup-${mediaItemSeq}.mp3`, fileFormat: "mp3", duration: 3600, libraryRootId: root.id },
  });
  return item.id;
}

async function count(table: string, where: Record<string, unknown> = {}): Promise<number> {
  const model = (prisma as any)[table];
  return model.count({ where });
}

beforeAll(async () => {
  prisma = new PrismaClient();
  auth = new AuthService({ prisma, now });
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  db.cleanup();
});

describe("AuthService.cleanupExpired()", () => {
  beforeEach(async () => {
    // Clean slate per test: truncate all tables Prisma tracks for this service.
    await prisma.webAuthnChallenge.deleteMany();
    await prisma.webAuthnCredential.deleteMany();
    await prisma.deviceCredential.deleteMany();
    await prisma.session.deleteMany();
    await prisma.adminSession.deleteMany();
    await prisma.favourite.deleteMany();
    await prisma.wishlistItem.deleteMany();
    await prisma.profileLibraryEntry.deleteMany();
    await prisma.playSession.deleteMany();
    await prisma.listeningHistory.deleteMany();
    await prisma.profile.deleteMany();
    clock = new Date("2026-01-01T00:00:00.000Z");
  });

  it("deletes expired and revoked sessions", async () => {
    const profile = await createProfile("alive", now());
    await createSession(profile.id, true, false);   // expired
    await createSession(profile.id, false, true);   // revoked
    await createSession(profile.id, false, false);  // active

    await auth.cleanupExpired();

    expect(await count("session")).toBe(1);
  });

  it("deletes expired webauthn challenges", async () => {
    await createWebAuthnChallenge(null, true);   // expired
    await createWebAuthnChallenge(null, false);  // active

    await auth.cleanupExpired();

    expect(await count("webAuthnChallenge")).toBe(1);
  });

  it("deletes expired or revoked device credentials", async () => {
    const profile = await createProfile("alive", now());
    await createDeviceCredential(profile.id, true, false);   // expired
    await createDeviceCredential(profile.id, false, true);   // revoked
    await createDeviceCredential(profile.id, false, false);  // active

    await auth.cleanupExpired();

    expect(await count("deviceCredential")).toBe(1);
  });

  it("deletes expired or revoked admin sessions", async () => {
    await createAdminSession(true, false);   // expired
    await createAdminSession(false, true);   // revoked
    await createAdminSession(false, false);  // active

    await auth.cleanupExpired();

    expect(await count("adminSession")).toBe(1);
  });

  it("deletes inactive profile (lastActiveAt older than 24 months) and cascades", async () => {
    const inactive = await createProfile("inactive", new Date("2023-01-01T00:00:00.000Z"));
    const active = await createProfile("active", now());
    await createSession(active.id, false, false);

    // Seed related data for the inactive profile
    await createSession(inactive.id, false, false);
    await createDeviceCredential(inactive.id, false, false);
    await createWebAuthnChallenge(inactive.id, false);
    const historyMediaId = await createMediaItem("History Book");
    await prisma.listeningHistory.create({
      data: { profileId: inactive.id, mediaItemId: historyMediaId, position: 0, playedAt: now() },
    });
    const favouriteMediaId = await createMediaItem("Favourite Book");
    await prisma.favourite.create({ data: { profileId: inactive.id, mediaItemId: favouriteMediaId } });

    await auth.cleanupExpired();

    expect(await prisma.profile.findUnique({ where: { id: inactive.id } })).toBeNull();
    expect(await prisma.profile.findUnique({ where: { id: active.id } })).not.toBeNull();
    expect(await count("session", { profileId: inactive.id })).toBe(0);
    expect(await count("deviceCredential", { profileId: inactive.id })).toBe(0);
    expect(await count("webAuthnChallenge", { profileId: inactive.id })).toBe(0);
    expect(await count("listeningHistory", { profileId: inactive.id })).toBe(0);
    expect(await count("favourite", { profileId: inactive.id })).toBe(0);
    // Active profile's data untouched
    expect(await count("session", { profileId: active.id })).toBe(1);
  });

  it("deletes never-used profile (lastActiveAt null, createdAt older than 24 months)", async () => {
    const neverUsed = await createProfile("never-used", null, new Date("2023-01-01T00:00:00.000Z"));
    const recentlyCreated = await createProfile("recent", null, now());

    await auth.cleanupExpired();

    expect(await prisma.profile.findUnique({ where: { id: neverUsed.id } })).toBeNull();
    expect(await prisma.profile.findUnique({ where: { id: recentlyCreated.id } })).not.toBeNull();
  });

  it("keeps active profile (lastActiveAt within 24 months)", async () => {
    const active = await createProfile("active", now());

    await auth.cleanupExpired();

    expect(await prisma.profile.findUnique({ where: { id: active.id } })).not.toBeNull();
  });

  it("keeps session exactly at expiry boundary (not lt)", async () => {
    const profile = await createProfile("alive", now());
    await prisma.session.create({
      data: {
        id: newSessionId(),
        tokenHash: hashSessionToken(newSessionToken()),
        profileId: profile.id,
        via: "profile",
        expiresAt: now(), // exactly now, not in the past
        revokedAt: null,
      },
    });

    await auth.cleanupExpired();

    expect(await count("session")).toBe(1);
  });
});