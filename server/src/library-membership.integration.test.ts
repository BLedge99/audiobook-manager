import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { buildApp, SESSION_HEADER } from "./app";
import { addBookToFollowingProfiles, giveProfileEveryBook } from "./library-membership";

/**
 * Spec 27 — per-profile library membership.
 *
 * The feature has one decision worth testing hard: **existing profiles keep
 * everything, new profiles start empty**. Everything else follows from that.
 *
 * The other property worth protecting is that the *server* library and the
 * *profile* library are different things. A book removed from a profile is
 * still on the server, and the Server library tab still lists it.
 */

const dir = mkdtempSync(path.join(tmpdir(), "audiobook-membership-"));
const dbFile = path.join(dir, "test.db");
process.env.DATABASE_URL = `file:${dbFile}`;

let app: Awaited<ReturnType<typeof buildApp>>;
const prisma = new PrismaClient();
let token = "";

beforeAll(async () => {
  execSync(`npx prisma db push --accept-data-loss --schema "${path.join(__dirname, "..", "prisma", "schema.test.prisma")}"`, {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: `file:${dbFile}` },
    stdio: "ignore",
  });
  app = await buildApp({ logger: false, appPassword: "household" });
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "household" } });
  token = login.json().token;
}, 120_000);

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

/** Authenticated headers for a given profile. */
function headers(profileId?: number) {
  return {
    [SESSION_HEADER]: token,
    origin: "https://localhost",
    ...(profileId ? { "x-profile-id": String(profileId) } : {}),
  };
}

/** A book on the server, with a track so the payload has a real BigInt in it. */
async function makeBook(title: string) {
  // A book belongs to a library root, and the root is created on demand --
  // these tests are about membership, not about scanning.
  const root =
    (await prisma.libraryRoot.findFirst()) ??
    (await prisma.libraryRoot.create({ data: { path: "/lib", label: "Test" } }));
  const item = await prisma.mediaItem.create({
    data: {
      libraryRootId: root.id,
      filePath: `/lib/membership-${Date.now()}-${title}`,
      title,
      author: "An Author",
      fileFormat: "mp3",
      duration: 300,
    },
  });
  await prisma.track.create({
    data: {
      mediaItemId: item.id,
      filePath: `/lib/membership-${Date.now()}-${title}.mp3`,
      title: "Track 1",
      duration: 300,
      trackNumber: 1,
      sizeBytes: BigInt(1024),
    },
  });
  return item;
}

async function makeProfile(name: string) {
  return prisma.profile.create({ data: { name } });
}

beforeEach(async () => {
  // Start each test from a known set of books and profiles.
  await prisma.profileLibraryEntry.deleteMany();
  await prisma.profile.deleteMany();
  await prisma.mediaItem.deleteMany();
  await prisma.track.deleteMany();
});

describe("the profile library is the caller's membership", () => {
  it("returns only the books the calling profile holds", async () => {
    const held = await makeBook("Held");
    const other = await makeBook("Other");
    const profile = await makeProfile("Reader");
    await prisma.profileLibraryEntry.create({ data: { profileId: profile.id, mediaItemId: held.id } });

    const res = await app.inject({ method: "GET", url: "/api/audiobooks", headers: headers(profile.id) });
    expect(res.statusCode).toBe(200);
    const titles = res.json().map((book: { title: string }) => book.title);
    expect(titles).toEqual(["Held"]);
    expect(titles).not.toContain(other.title);
  });

  it("returns the whole server library when no profile is given", async () => {
    // No caller, no scoping. This is the same answer the endpoint gave before
    // spec 27, which keeps the unscoped API and the tooling working.
    await makeBook("One");
    await makeBook("Two");
    const res = await app.inject({ method: "GET", url: "/api/audiobooks", headers: headers() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
  });

  it("gives a new profile an empty library while the server keeps its books", async () => {
    await makeBook("On the server");
    const profile = await makeProfile("Fresh");

    const res = await app.inject({ method: "GET", url: "/api/audiobooks", headers: headers(profile.id) });
    expect(res.json()).toHaveLength(0);

    // The server library is a property of the filesystem, not of a profile.
    const server = await app.inject({ method: "GET", url: "/api/server-library", headers: headers(profile.id) });
    expect(server.json()).toHaveLength(1);
  });
});

describe("adding and removing", () => {
  it("adds a book to the calling profile", async () => {
    const book = await makeBook("Wanted");
    const profile = await makeProfile("Reader");

    const res = await app.inject({
      method: "POST",
      url: `/api/audiobooks/${book.id}/library`,
      headers: headers(profile.id),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ added: true, inLibrary: true });

    const library = await app.inject({ method: "GET", url: "/api/audiobooks", headers: headers(profile.id) });
    expect(library.json().map((b: { title: string }) => b.title)).toEqual(["Wanted"]);
  });

  it("is idempotent: adding the same book twice is not an error", async () => {
    const book = await makeBook("Wanted");
    const profile = await makeProfile("Reader");

    const first = await app.inject({ method: "POST", url: `/api/audiobooks/${book.id}/library`, headers: headers(profile.id) });
    const second = await app.inject({ method: "POST", url: `/api/audiobooks/${book.id}/library`, headers: headers(profile.id) });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ added: false, inLibrary: true });
    expect(await prisma.profileLibraryEntry.count({ where: { profileId: profile.id } })).toBe(1);
  });

  it("removes a book from the calling profile only", async () => {
    const book = await makeBook("Shared");
    const one = await makeProfile("One");
    const two = await makeProfile("Two");
    await prisma.profileLibraryEntry.createMany({
      data: [
        { profileId: one.id, mediaItemId: book.id },
        { profileId: two.id, mediaItemId: book.id },
      ],
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/api/audiobooks/${book.id}/library`,
      headers: headers(one.id),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ removed: true, inLibrary: false });

    const first = await app.inject({ method: "GET", url: "/api/audiobooks", headers: headers(one.id) });
    const second = await app.inject({ method: "GET", url: "/api/audiobooks", headers: headers(two.id) });
    expect(first.json()).toHaveLength(0);
    expect(second.json()).toHaveLength(1);
  });

  it("leaves the book on the server when it is removed from a profile", async () => {
    // A book removed from every profile appears in nobody's shelf. It is not
    // deleted from disk: the server library is a property of the filesystem.
    const book = await makeBook("Still on the server");
    const profile = await makeProfile("Reader");
    await prisma.profileLibraryEntry.create({ data: { profileId: profile.id, mediaItemId: book.id } });

    await app.inject({ method: "DELETE", url: `/api/audiobooks/${book.id}/library`, headers: headers(profile.id) });

    expect(await prisma.mediaItem.count()).toBe(1);
    const server = await app.inject({ method: "GET", url: "/api/server-library", headers: headers(profile.id) });
    expect(server.json()).toHaveLength(1);
    expect(server.json()[0].inLibrary).toBe(false);
  });

  it("needs a profile", async () => {
    const book = await makeBook("Wanted");
    const res = await app.inject({ method: "POST", url: `/api/audiobooks/${book.id}/library`, headers: headers() });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a bad id rather than 500ing on it", async () => {
    const profile = await makeProfile("Reader");
    const res = await app.inject({ method: "POST", url: "/api/audiobooks/abc/library", headers: headers(profile.id) });
    expect(res.statusCode).toBe(400);
  });

  it("404s for a book that does not exist", async () => {
    const profile = await makeProfile("Reader");
    const res = await app.inject({ method: "POST", url: "/api/audiobooks/999999/library", headers: headers(profile.id) });
    expect(res.statusCode).toBe(404);
  });
});

describe("the server library listing", () => {
  it("marks the books the profile already has", async () => {
    const held = await makeBook("Held");
    await makeBook("Not held");
    const profile = await makeProfile("Reader");
    await prisma.profileLibraryEntry.create({ data: { profileId: profile.id, mediaItemId: held.id } });

    const res = await app.inject({ method: "GET", url: "/api/server-library", headers: headers(profile.id) });
    const rows = res.json();
    expect(rows).toHaveLength(2);
    expect(rows.find((r: { title: string }) => r.title === "Held").inLibrary).toBe(true);
    expect(rows.find((r: { title: string }) => r.title === "Not held").inLibrary).toBe(false);
  });
});

describe("existing and new profiles", () => {
  it("a profile created now starts empty and does not follow the server library", async () => {
    // The one line the spec points at. A new profile is a fresh start: it
    // contains nothing, and a book scanned later does not appear in it.
    const profile = await makeProfile("Brand new");
    expect(profile.followsServerLibrary).toBe(false);
    expect(await prisma.profileLibraryEntry.count({ where: { profileId: profile.id } })).toBe(0);
  });

  it("a profile that follows the server library receives newly scanned books", async () => {
    // This is what makes a fresh install behave like a migrated one.
    const profile = await makeProfile("Standing");
    await prisma.profile.update({ where: { id: profile.id }, data: { followsServerLibrary: true } });

    const book = await makeBook("Scanned later");
    await addBookToFollowingProfiles(prisma, book.id);

    const rows = await prisma.profileLibraryEntry.findMany({ where: { profileId: profile.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].mediaItemId).toBe(book.id);
  });

  it("a profile that does not follow it does not receive newly scanned books", async () => {
    const profile = await makeProfile("Curated");
    const book = await makeBook("Scanned later");
    await addBookToFollowingProfiles(prisma, book.id);

    expect(await prisma.profileLibraryEntry.count({ where: { profileId: profile.id } })).toBe(0);
  });

  it("giveProfileEveryBook gives a profile the whole server library", async () => {
    await makeBook("One");
    await makeBook("Two");
    const profile = await makeProfile("Filled");
    const added = await giveProfileEveryBook(prisma, profile.id);

    expect(added).toBe(2);
    expect(await prisma.profileLibraryEntry.count({ where: { profileId: profile.id } })).toBe(2);
  });

  it("giveProfileEveryBook is idempotent", async () => {
    await makeBook("One");
    const profile = await makeProfile("Filled");
    await giveProfileEveryBook(prisma, profile.id);
    const second = await giveProfileEveryBook(prisma, profile.id);

    expect(second).toBe(0);
    expect(await prisma.profileLibraryEntry.count({ where: { profileId: profile.id } })).toBe(1);
  });
});

describe("what membership does not touch", () => {
  it("keeps progress for a book that leaves and comes back", async () => {
    // The progress row is keyed (profile, book) and is never deleted by a
    // membership change, so a book that comes back is where it was left.
    const book = await makeBook("Resumed");
    const profile = await makeProfile("Reader");
    await prisma.profileLibraryEntry.create({ data: { profileId: profile.id, mediaItemId: book.id } });
    await prisma.listeningHistory.create({
      data: { profileId: profile.id, mediaItemId: book.id, position: 120, completed: false },
    });

    await app.inject({ method: "DELETE", url: `/api/audiobooks/${book.id}/library`, headers: headers(profile.id) });
    await app.inject({ method: "POST", url: `/api/audiobooks/${book.id}/library`, headers: headers(profile.id) });

    const res = await app.inject({ method: "GET", url: "/api/audiobooks", headers: headers(profile.id) });
    expect(res.json()[0].progress).toMatchObject({ position: 120 });
  });
});
