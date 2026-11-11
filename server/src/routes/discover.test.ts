import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../app";
import { createTestDatabase } from "../test-support/database";

const db = createTestDatabase("audiobook-discover-test-");

let app: Awaited<ReturnType<typeof buildApp>>;
let prisma: PrismaClient;
let profileId: number;
let bookId: number;

beforeAll(async () => {
  prisma = new PrismaClient();
  const profile = await prisma.profile.create({ data: { name: "discover-tester", role: "member" } });
  profileId = profile.id;
  const root = await prisma.libraryRoot.create({ data: { path: "/discover-test-root", label: "test" } });
  const book = await prisma.mediaItem.create({
    data: { title: "A Deterministic Mystery", author: "Test Author", filePath: "/discover-test-root/a.mp3", fileFormat: "mp3", libraryRootId: root.id },
  });
  bookId = book.id;
  app = await buildApp({ logger: false, prisma });
}, 120_000);

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  db.cleanup();
});

describe("discover", () => {
  it("asks for a profile for for-me", async () => {
    const response = await app.inject({ method: "GET", url: "/api/discover/for-me" });
    expect(response.statusCode).toBe(400);
  });

  it("returns insufficient-metadata for a profile with no favourites", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/discover/for-me?page=2&pageSize=3",
      headers: { "x-profile-id": String(profileId) },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { status: string; recommendations: unknown[]; page: number; pageSize: number };
    expect(body.status).toBe("insufficient-metadata");
    expect(body.recommendations).toEqual([]);
    expect(body.page).toBe(2);
    expect(body.pageSize).toBe(3);
  });

  it("caps pageSize rather than trusting it", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/discover/for-me?pageSize=1000",
      headers: { "x-profile-id": String(profileId) },
    });
    // Fastify rejects out-of-range querystrings against the schema.
    expect(response.statusCode).toBe(400);
  });

  it("404s similar for an unknown book", async () => {
    const response = await app.inject({ method: "GET", url: "/api/discover/similar/999999", headers: { "x-profile-id": String(profileId) } });
    expect(response.statusCode).toBe(404);
  });

  it("returns insufficient-metadata for a book with no genres", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/discover/similar/${bookId}?page=1&pageSize=2`,
      headers: { "x-profile-id": String(profileId) },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { status: string; page: number; pageSize: number };
    expect(body.status).toBe("insufficient-metadata");
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(2);
  });
});

describe("wishlist", () => {
  it("adds, lists, marks owned and deletes a wishlist item", async () => {
    const added = await app.inject({
      method: "POST",
      url: "/api/wishlist",
      headers: { "x-profile-id": String(profileId) },
      payload: { title: "Wishlisted Title", author: "Someone", provider: "openlibrary", providerKey: "OL123W" },
    });
    expect(added.statusCode).toBe(201);
    const item = added.json() as { id: number; title: string; playable: boolean; owned: boolean };
    expect(item.playable).toBe(false);
    expect(item.owned).toBe(false);

    const listed = await app.inject({
      method: "GET",
      url: "/api/wishlist",
      headers: { "x-profile-id": String(profileId) },
    });
    expect(listed.statusCode).toBe(200);
    const items = listed.json() as Array<{ id: number }>;
    expect(items.map((entry) => entry.id)).toContain(item.id);

    const marked = await app.inject({
      method: "PUT",
      url: `/api/wishlist/${item.id}/owned`,
      headers: { "x-profile-id": String(profileId) },
      payload: { owned: true },
    });
    expect(marked.statusCode).toBe(200);
    expect((marked.json() as { owned: boolean }).owned).toBe(true);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/wishlist/${item.id}`,
      headers: { "x-profile-id": String(profileId) },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ deleted: true });

    const emptied = await app.inject({
      method: "GET",
      url: "/api/wishlist",
      headers: { "x-profile-id": String(profileId) },
    });
    expect((emptied.json() as unknown[]).find((entry) => (entry as { id: number }).id === item.id)).toBeUndefined();
  });

  it("requires provider and providerKey", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/wishlist",
      headers: { "x-profile-id": String(profileId) },
      payload: { title: "Missing keys" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("404s deleting another profile's wishlist item", async () => {
    const other = await prisma.profile.create({ data: { name: "discover-other", role: "member" } });
    const row = await prisma.wishlistItem.create({
      data: { profileId: other.id, title: "Not yours", provider: "openlibrary", providerKey: "OL999W" },
    });
    const response = await app.inject({
      method: "DELETE",
      url: `/api/wishlist/${row.id}`,
      headers: { "x-profile-id": String(profileId) },
    });
    expect(response.statusCode).toBe(404);
  });
});
