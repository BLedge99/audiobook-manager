import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { tmpdir } from "node:os";
import { buildApp } from "../app";
import { createTestDatabase } from "../test-support/database";

const db = createTestDatabase("audiobook-library-test-");

let app: Awaited<ReturnType<typeof buildApp>>;
let prisma: PrismaClient;
let profileId: number;
let rootId: number;
let bookId: number;

beforeAll(async () => {
  prisma = new PrismaClient();
  const profile = await prisma.profile.create({ data: { name: "library-tester", role: "member" } });
  profileId = profile.id;
  const root = await prisma.libraryRoot.create({ data: { path: "/library-test-root", label: "test" } });
  rootId = root.id;
  const genre = await prisma.genre.create({ data: { slug: "test-fiction", name: "Test Fiction" } });
  const book = await prisma.mediaItem.create({
    data: {
      title: "A Library Book",
      author: "An Author",
      filePath: "/library-test-root/book.mp3",
      fileFormat: "mp3",
      libraryRootId: rootId,
      genres: { create: [{ genreId: genre.id, source: "user" }] },
      contributors: { create: [{ contributor: { create: { name: "A Narrator", role: "narrator" } } }] },
    },
  });
  bookId = book.id;
  // The book starts in this profile's library.
  await prisma.profileLibraryEntry.create({ data: { profileId, mediaItemId: bookId } });
  app = await buildApp({ logger: false, prisma });
}, 120_000);

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  db.cleanup();
});

describe("GET /api/audiobooks", () => {
  it("returns the profile's library with the unified book shape", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/audiobooks",
      headers: { "x-profile-id": String(profileId) },
    });
    expect(response.statusCode).toBe(200);
    const books = response.json() as Array<Record<string, unknown>>;
    const book = books.find((entry) => entry.id === bookId)!;
    expect(book).toBeDefined();
    // Paths never leave the server.
    expect(book.filePath).toBeUndefined();
    expect(book.coverImagePath).toBeUndefined();
    // One flattened contributors shape everywhere.
    expect(book.contributors).toEqual([{ id: expect.any(Number), name: "A Narrator", role: "narrator" }]);
    expect(book.genres).toEqual([
      expect.objectContaining({ slug: "test-fiction", name: "Test Fiction", source: "user" }),
    ]);
  });

  it("answers 304 when nothing changed", async () => {
    const first = await app.inject({
      method: "GET",
      url: "/api/audiobooks",
      headers: { "x-profile-id": String(profileId) },
    });
    expect(first.statusCode).toBe(200);
    const etag = first.headers.etag as string;
    expect(etag).toBeTruthy();

    const second = await app.inject({
      method: "GET",
      url: "/api/audiobooks",
      headers: { "x-profile-id": String(profileId), "if-none-match": etag },
    });
    expect(second.statusCode).toBe(304);
  });
});

describe("server-library membership", () => {
  it("marks inLibrary on the server-library listing and toggles with membership", async () => {
    // Start from not-in-library.
    await app.inject({
      method: "DELETE",
      url: `/api/audiobooks/${bookId}/library`,
      headers: { "x-profile-id": String(profileId) },
    });
    const before = await app.inject({
      method: "GET",
      url: "/api/server-library",
      headers: { "x-profile-id": String(profileId) },
    });
    expect(before.statusCode).toBe(200);
    const held = (before.json() as Array<{ id: number; inLibrary: boolean }>).find((entry) => entry.id === bookId)!;
    expect(held.inLibrary).toBe(false);

    const added = await app.inject({
      method: "POST",
      url: `/api/audiobooks/${bookId}/library`,
      headers: { "x-profile-id": String(profileId) },
    });
    expect(added.statusCode).toBe(200);
    expect(added.json()).toEqual({ added: true, inLibrary: true });

    const again = await app.inject({
      method: "POST",
      url: `/api/audiobooks/${bookId}/library`,
      headers: { "x-profile-id": String(profileId) },
    });
    expect(again.json()).toEqual({ added: false, inLibrary: true });

    const after = await app.inject({
      method: "GET",
      url: "/api/server-library",
      headers: { "x-profile-id": String(profileId) },
    });
    const heldNow = (after.json() as Array<{ id: number; inLibrary: boolean }>).find((entry) => entry.id === bookId)!;
    expect(heldNow.inLibrary).toBe(true);

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/audiobooks/${bookId}/library`,
      headers: { "x-profile-id": String(profileId) },
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toEqual({ removed: true, inLibrary: false });
  });

  it("404s adding an unknown book", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/audiobooks/999999/library",
      headers: { "x-profile-id": String(profileId) },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("library roots", () => {
  it("creates, lists and deletes a root", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/library-roots",
      payload: { path: tmpdir(), label: "Root Label" },
    });
    expect(created.statusCode).toBe(201);
    const root = created.json() as { id: number; path: string; label: string };
    expect(root.label).toBe("Root Label");

    const listed = await app.inject({ method: "GET", url: "/api/library-roots" });
    expect(listed.statusCode).toBe(200);
    expect((listed.json() as Array<{ id: number }>).map((entry) => entry.id)).toContain(root.id);

    const deleted = await app.inject({ method: "DELETE", url: `/api/library-roots/${root.id}` });
    expect(deleted.statusCode).toBe(204);
  });

  it("rejects an inaccessible path", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/library-roots",
      payload: { path: "/definitely/not/a/real/path/for/testing" },
    });
    expect(response.statusCode).toBe(400);
  });
});
