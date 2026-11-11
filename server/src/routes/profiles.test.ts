import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../app";
import { createTestDatabase } from "../test-support/database";

const db = createTestDatabase("audiobook-profiles-test-");

let app: Awaited<ReturnType<typeof buildApp>>;
let prisma: PrismaClient;
let profileId: number;
let bookId: number;

beforeAll(async () => {
  prisma = new PrismaClient();
  const root = await prisma.libraryRoot.create({ data: { path: "/profiles-test-root", label: "test" } });
  const profile = await prisma.profile.create({ data: { name: "profiles-tester", role: "member" } });
  profileId = profile.id;
  const book = await prisma.mediaItem.create({
    data: {
      title: "A Favourite Book",
      author: "An Author",
      filePath: "/profiles-test-root/book.mp3",
      fileFormat: "mp3",
      libraryRootId: root.id,
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

describe("profile CRUD", () => {
  it("creates, lists and deletes a profile", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/profiles",
      payload: { name: "Route Created", color: "blue" },
    });
    expect(created.statusCode).toBe(201);
    const createdProfile = created.json() as { id: number; name: string };

    const listed = await app.inject({ method: "GET", url: "/api/profiles" });
    expect(listed.statusCode).toBe(200);
    expect((listed.json() as Array<{ id: number }>).map((entry) => entry.id)).toContain(createdProfile.id);

    const deleted = await app.inject({ method: "DELETE", url: `/api/profiles/${createdProfile.id}` });
    expect(deleted.statusCode).toBe(204);
  });

  it("rejects a duplicate profile name with 409", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/profiles",
      payload: { name: "profiles-tester" },
    });
    expect(response.statusCode).toBe(409);
  });
});

describe("favourites", () => {
  it("favourites, lists ids, and unfavourites a book", async () => {
    const fav = await app.inject({
      method: "PUT",
      url: `/api/audiobooks/${bookId}/favourite`,
      headers: { "x-profile-id": String(profileId) },
    });
    expect(fav.statusCode).toBe(200);

    const ids = await app.inject({
      method: "GET",
      url: "/api/favourites/ids",
      headers: { "x-profile-id": String(profileId) },
    });
    expect(ids.statusCode).toBe(200);
    expect(ids.json()).toContain(bookId);

    const listed = await app.inject({
      method: "GET",
      url: "/api/favourites",
      headers: { "x-profile-id": String(profileId) },
    });
    expect(listed.statusCode).toBe(200);
    const books = listed.json() as Array<{ book: { id: number } }>;
    expect(books.map((entry) => entry.book.id)).toContain(bookId);

    const unfav = await app.inject({
      method: "DELETE",
      url: `/api/audiobooks/${bookId}/favourite`,
      headers: { "x-profile-id": String(profileId) },
    });
    expect(unfav.statusCode).toBe(200);

    const idsAfter = await app.inject({
      method: "GET",
      url: "/api/favourites/ids",
      headers: { "x-profile-id": String(profileId) },
    });
    expect(idsAfter.json()).not.toContain(bookId);
  });

});
