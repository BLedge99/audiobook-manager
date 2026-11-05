import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { buildApp, SESSION_HEADER } from "./app";
import { hashPassword } from "./auth/password";
import { hashSessionToken, newSessionId, newSessionToken } from "./auth/session";
import { createTestDatabase } from "./test-support/database";

const db = createTestDatabase("audiobook-export-test-");
const dir = db.dir;

let app: Awaited<ReturnType<typeof buildApp>>;
let prisma: PrismaClient;

async function createProfile(name: string, password: string | null = "pw-" + name): Promise<{ id: number; token: string }> {
  const profile = await prisma.profile.create({
    data: {
      name,
      role: "member",
      passwordHash: password ? await hashPassword(password) : null,
      passwordUpdatedAt: password ? new Date() : null,
    },
  });
  const token = newSessionToken();
  await prisma.session.create({
    data: {
      id: newSessionId(),
      tokenHash: hashSessionToken(token),
      profileId: profile.id,
      via: "profile",
      userAgent: "test-agent",
      deviceLabel: "test-device",
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    },
  });
  return { id: profile.id, token };
}

async function seedProfileData(profileId: number, mediaIds: number[]) {
  const [m1, m2, m3, m4] = mediaIds;
  await prisma.listeningHistory.create({
    data: { profileId, mediaItemId: m1, position: 120, completed: false, playedAt: new Date() },
  });
  await prisma.playSession.create({
    data: { profileId, mediaItemId: m1, startedAt: new Date(), endedAt: new Date(), fromPosition: 0, toPosition: 120, speed: 1 },
  });
  await prisma.favourite.create({ data: { profileId, mediaItemId: m2 } });
  await prisma.wishlistItem.create({ data: { profileId, title: "Wishlisted Book", author: "Author", seedMediaItemId: m3, owned: false } });
  await prisma.profileLibraryEntry.create({ data: { profileId, mediaItemId: m4 } });
  await prisma.deviceCredential.create({ data: { id: randomUUID(), profileId, secretHash: randomUUID(), label: "Test Device", expiresAt: new Date(Date.now() + 1000 * 60 * 60) } });
  await prisma.webAuthnCredential.create({ data: { id: randomUUID(), profileId, credentialId: randomUUID(), publicKey: "pub-key", counter: 0 } });
}

async function createMediaItems(suffix = ""): Promise<number[]> {
  const root = await prisma.libraryRoot.create({
    data: { path: `/test/library-${suffix || Date.now()}`, label: "Test Library" },
  });
  const items = await Promise.all([
    prisma.mediaItem.create({ data: { title: "Book One", author: "Test Author", filePath: `/test/book-one${suffix}.mp3`, fileFormat: "mp3", duration: 3600, libraryRootId: root.id } }),
    prisma.mediaItem.create({ data: { title: "Book Two", author: "Test Author", filePath: `/test/book-two${suffix}.mp3`, fileFormat: "mp3", duration: 3600, libraryRootId: root.id } }),
    prisma.mediaItem.create({ data: { title: "Book Three", author: "Test Author", filePath: `/test/book-three${suffix}.mp3`, fileFormat: "mp3", duration: 3600, libraryRootId: root.id } }),
    prisma.mediaItem.create({ data: { title: "Book Four", author: "Test Author", filePath: `/test/book-four${suffix}.mp3`, fileFormat: "mp3", duration: 3600, libraryRootId: root.id } }),
  ]);
  return items.map((i) => i.id);
}

beforeAll(async () => {
  prisma = new PrismaClient();
  app = await buildApp({ logger: false, appPassword: "household", mediaTokenSecret: "m".repeat(32), prisma });
}, 120_000);

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  db.cleanup();
});

describe("GET /api/me/export", () => {
  it("returns 401 when no session", async () => {
    const res = await app.inject({ method: "GET", url: "/api/me/export" });
    expect(res.statusCode).toBe(401);
    expect(res.json<{ code: string }>().code).toBe("auth_required");
  });

  it("returns all personal data for the authenticated profile only", async () => {
    const mediaIds = await createMediaItems("owner");
    const owner = await createProfile("owner");
    const other = await createProfile("other");

    await seedProfileData(owner.id, mediaIds);
    await seedProfileData(other.id, mediaIds);

    const res = await app.inject({
      method: "GET",
      url: "/api/me/export",
      headers: { [SESSION_HEADER]: owner.token },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      profile: { id: number; name: string };
      sessions: Array<{ id: string }>;
      listeningHistory: Array<{ mediaItemId: number }>;
      playSessions: Array<{ mediaItemId: number }>;
      favourites: Array<{ mediaItemId: number }>;
      wishlistItems: Array<{ id: number; title: string }>;
      libraryEntries: Array<{ mediaItemId: number }>;
      deviceCredentials: Array<{ label: string }>;
      webAuthnCredentials: Array<{ credentialId: string }>;
    }>();

    expect(body.profile.id).toBe(owner.id);
    expect(body.profile.name).toBe("owner");

    expect(body.sessions).toHaveLength(1);
    expect(body.listeningHistory).toHaveLength(1);
    expect(body.playSessions).toHaveLength(1);
    expect(body.favourites).toHaveLength(1);
    expect(body.wishlistItems).toHaveLength(1);
    expect(body.libraryEntries).toHaveLength(1);
    expect(body.deviceCredentials).toHaveLength(1);
    expect(body.webAuthnCredentials).toHaveLength(1);

    expect(body.wishlistItems[0].title).toBe("Wishlisted Book");
  });

  it("never returns token hashes or password hashes", async () => {
    const mediaIds = await createMediaItems("secret");
    const owner = await createProfile("secret-owner");
    await seedProfileData(owner.id, mediaIds);

    const res = await app.inject({
      method: "GET",
      url: "/api/me/export",
      headers: { [SESSION_HEADER]: owner.token },
    });

    const payload = JSON.stringify(res.json());
    expect(payload).not.toContain("tokenHash");
    expect(payload).not.toContain("passwordHash");
    expect(payload).not.toContain("secretHash");
    expect(payload).not.toContain("scrypt");
  });
});

describe("DELETE /api/me", () => {
  it("returns 401 when no session", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/me" });
    expect(res.statusCode).toBe(401);
    expect(res.json<{ code: string }>().code).toBe("auth_required");
  });

  it("deletes the account and all related data, leaving other profiles untouched", async () => {
    const mediaIds = await createMediaItems("delete-owner");
    const owner = await createProfile("delete-owner");
    const other = await createProfile("delete-other");

    await seedProfileData(owner.id, mediaIds);
    await seedProfileData(other.id, mediaIds);

    const res = await app.inject({
      method: "DELETE",
      url: "/api/me",
      headers: { [SESSION_HEADER]: owner.token },
    });

    expect(res.statusCode).toBe(204);

    // Owner's profile is gone
    const deletedProfile = await prisma.profile.findUnique({ where: { id: owner.id } });
    expect(deletedProfile).toBeNull();

    // All owner's related rows are gone
    expect(await prisma.session.count({ where: { profileId: owner.id } })).toBe(0);
    expect(await prisma.listeningHistory.count({ where: { profileId: owner.id } })).toBe(0);
    expect(await prisma.playSession.count({ where: { profileId: owner.id } })).toBe(0);
    expect(await prisma.favourite.count({ where: { profileId: owner.id } })).toBe(0);
    expect(await prisma.wishlistItem.count({ where: { profileId: owner.id } })).toBe(0);
    expect(await prisma.profileLibraryEntry.count({ where: { profileId: owner.id } })).toBe(0);
    expect(await prisma.deviceCredential.count({ where: { profileId: owner.id } })).toBe(0);
    expect(await prisma.webAuthnCredential.count({ where: { profileId: owner.id } })).toBe(0);

    // Other profile is untouched
    const otherProfile = await prisma.profile.findUnique({ where: { id: other.id } });
    expect(otherProfile).not.toBeNull();
    expect(await prisma.session.count({ where: { profileId: other.id } })).toBe(1);
    expect(await prisma.listeningHistory.count({ where: { profileId: other.id } })).toBe(1);
  });

  it("PATCH /api/me updates name and colour for the authenticated profile only", async () => {
    const mediaIds = await createMediaItems("patch-me");
    const owner = await createProfile("patch-owner");

    const res = await app.inject({
      method: "PATCH",
      url: "/api/me",
      headers: { [SESSION_HEADER]: owner.token },
      body: { name: "Renamed Owner", color: "#ff0000" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ id: number; name: string; color: string }>();
    expect(body.id).toBe(owner.id);
    expect(body.name).toBe("Renamed Owner");
    expect(body.color).toBe("#ff0000");

    // Verify in DB
    const profile = await prisma.profile.findUnique({ where: { id: owner.id } });
    expect(profile?.name).toBe("Renamed Owner");
    expect(profile?.color).toBe("#ff0000");
  });

  it("DELETE /api/me/listening-history/:id removes one entry", async () => {
    const mediaIds = await createMediaItems("delete-history");
    const owner = await createProfile("delete-history-owner");
    await seedProfileData(owner.id, mediaIds);

    const history = await prisma.listeningHistory.findFirst({ where: { profileId: owner.id } });
    expect(history).not.toBeNull();

    const res = await app.inject({
      method: "DELETE",
      url: `/api/me/listening-history/${history!.id}`,
      headers: { [SESSION_HEADER]: owner.token },
    });

    expect(res.statusCode).toBe(204);
    expect(await prisma.listeningHistory.count({ where: { profileId: owner.id } })).toBe(0);
  });

  it("DELETE /api/me/favourites/:mediaItemId removes one favourite", async () => {
    const mediaIds = await createMediaItems("delete-fav");
    const owner = await createProfile("delete-fav-owner");
    await seedProfileData(owner.id, mediaIds);

    const res = await app.inject({
      method: "DELETE",
      url: `/api/me/favourites/${mediaIds[1]}`,
      headers: { [SESSION_HEADER]: owner.token },
    });

    expect(res.statusCode).toBe(204);
    expect(await prisma.favourite.count({ where: { profileId: owner.id } })).toBe(0);
  });
});
