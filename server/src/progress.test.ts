import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildApp } from "./app";

const dir = mkdtempSync(path.join(tmpdir(), "audiobook-progress-"));
const dbFile = path.join(dir, "test.db");
process.env.DATABASE_URL = `file:${dbFile}`;

let app: Awaited<ReturnType<typeof buildApp>>;
let cookie: string;
let profileId: number;
let bookId: number;
// Spec 27: needed to put books into a profile's library, which is now what
// makes a book visible in the library listing.
let prisma: import("@prisma/client").PrismaClient;

beforeAll(async () => {
  execSync(`npx prisma db push --accept-data-loss --schema "${path.join(__dirname, "..", "prisma", "schema.test.prisma")}"`, {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: `file:${dbFile}` },
    stdio: "ignore",
  });
  app = await buildApp({ logger: false, appPassword: "household" });
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "household" } });
  cookie = login.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const profile = await app.inject({ method: "POST", url: "/api/profiles", payload: { name: "Sam" }, headers: { cookie } });
  profileId = profile.json().id;

  const { PrismaClient } = await import("@prisma/client");
  prisma = new PrismaClient();
  const root = await prisma.libraryRoot.create({ data: { path: "/tmp/lib" } });
  const book = await prisma.mediaItem.create({
    data: { title: "Test Book", author: "Author", filePath: "/tmp/lib/book.m4b", fileFormat: "m4b", duration: 1000, libraryRootId: root.id },
  });
  bookId = book.id;
  // Spec 27: the library listing is scoped to the caller's membership, so a
  // profile has to actually hold the book for it to appear. These tests are
  // about progress, not membership -- but the setup has to be honest about
  // what a profile's library is.
  await prisma.profileLibraryEntry.create({ data: { profileId, mediaItemId: book.id } });
}, 120_000);

afterAll(async () => {
  await app.close();
  // Windows can still hold the SQLite handle briefly; a failed temp cleanup
  // must not fail an otherwise-green suite.
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

const profileHeaders = () => ({ cookie, "x-profile-id": String(profileId) });

describe("progress", () => {
  it("requires a profile header", async () => {
    const res = await app.inject({ method: "PUT", url: `/api/audiobooks/${bookId}/progress`, payload: { position: 5 }, headers: { cookie } });
    expect(res.statusCode).toBe(400);
  });

  it("saves and retrieves resume position", async () => {
    await app.inject({ method: "PUT", url: `/api/audiobooks/${bookId}/progress`, payload: { position: 123 }, headers: profileHeaders() });
    const res = await app.inject({ method: "GET", url: `/api/audiobooks/${bookId}/progress`, headers: profileHeaders() });
    expect(res.json()).toMatchObject({ position: 123, completed: false });
  });

  it("clamps negative and overlong positions", async () => {
    const neg = await app.inject({ method: "PUT", url: `/api/audiobooks/${bookId}/progress`, payload: { position: -50 }, headers: profileHeaders() });
    expect(neg.json().position).toBe(0);
    const over = await app.inject({ method: "PUT", url: `/api/audiobooks/${bookId}/progress`, payload: { position: 99999 }, headers: profileHeaders() });
    expect(over.json().position).toBe(1000);
    expect(over.json().completed).toBe(true);
  });

  it("marks completed near the end by default", async () => {
    const res = await app.inject({ method: "PUT", url: `/api/audiobooks/${bookId}/progress`, payload: { position: 960 }, headers: profileHeaders() });
    expect(res.json().completed).toBe(true);
  });

  it("keeps profiles isolated", async () => {
    const other = await app.inject({ method: "POST", url: "/api/profiles", payload: { name: "Alex" }, headers: { cookie } });
    const otherId = other.json().id;
    const res = await app.inject({ method: "GET", url: `/api/audiobooks/${bookId}/progress`, headers: { cookie, "x-profile-id": String(otherId) } });
    expect(res.json()).toMatchObject({ position: 0, completed: false });
  });

  /**
   * Regression: the read-then-write save raced with itself when the periodic,
   * pause and unmount savers all fired at once, leaving duplicate rows for one
   * (book, profile). Resume then read an arbitrary row and flip-flopped.
   */
  it("keeps exactly one resume row per book and profile under concurrent saves", async () => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const before = await prisma.listeningHistory.count({ where: { mediaItemId: bookId, profileId } });
      const saves = Array.from({ length: 8 }, (_, index) =>
        app.inject({ method: "PUT", url: `/api/audiobooks/${bookId}/progress`, payload: { position: 300 + index }, headers: profileHeaders() }));
      await Promise.all(saves);
      const after = await prisma.listeningHistory.count({ where: { mediaItemId: bookId, profileId } });
      expect(after).toBe(before);

      // The read-back must equal one of the values that was written, never a
      // mixture of two rows.
      const res = await app.inject({ method: "GET", url: `/api/audiobooks/${bookId}/progress`, headers: profileHeaders() });
      expect([300, 301, 302, 303, 304, 305, 306, 307]).toContain(res.json().position);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("rejects a non-numeric audiobook id instead of failing with a 500", async () => {
    const res = await app.inject({ method: "GET", url: "/api/audiobooks/abc", headers: { cookie } });
    expect(res.statusCode).toBe(400);
  });
});

/**
 * Spec 14: the library grid needs each book's saved position to render
 * "Continue listening" without one request per book.
 */
describe("library progress listing", () => {
  const listedBook = async (headers: Record<string, string>) => {
    const res = await app.inject({ method: "GET", url: "/api/audiobooks", headers });
    expect(res.statusCode).toBe(200);
    return (res.json() as { id: number; progress: { position: number; completed: boolean; lastPlayed: string } | null }[])
      .find((book) => book.id === bookId);
  };

  it("includes the caller's saved position", async () => {
    await app.inject({ method: "PUT", url: `/api/audiobooks/${bookId}/progress`, payload: { position: 400 }, headers: profileHeaders() });
    const book = await listedBook(profileHeaders());
    expect(book?.progress?.position).toBe(400);
    expect(typeof book?.progress?.lastPlayed).toBe("string");
  });

  it("returns null progress with no profile header instead of failing", async () => {
    // The library must render before a profile has been picked, so this route
    // deliberately never 400s the way PUT /progress does.
    const book = await listedBook({ cookie });
    expect(book?.progress).toBeNull();
  });

  it("returns null progress for a malformed profile header", async () => {
    const book = await listedBook({ cookie, "x-profile-id": "not-a-number" });
    expect(book?.progress).toBeNull();
  });

  it("never leaks another profile's position", async () => {
    const other = await app.inject({ method: "POST", url: "/api/profiles", payload: { name: "Riley" }, headers: { cookie } });
    const otherId = other.json().id;
    // The other profile has to *hold* the book for the test to mean anything:
    // spec 27 scopes the listing to the caller's membership, so a profile that
    // does not hold the book cannot see its progress at all. Giving it the
    // book keeps the leak test honest -- both profiles can see the book, and
    // only one can see the position.
    await prisma.profileLibraryEntry.create({ data: { profileId: otherId, mediaItemId: bookId } });
    const book = await listedBook({ cookie, "x-profile-id": String(otherId) });
    expect(book?.progress).toBeNull();
  });

  it("leaves books that have never been played at null", async () => {
    const fresh = await app.inject({ method: "POST", url: "/api/profiles", payload: { name: "NeverPlayed" }, headers: { cookie } });
    const freshId = fresh.json().id;
    await prisma.profileLibraryEntry.create({ data: { profileId: freshId, mediaItemId: bookId } });
    const res = await app.inject({ method: "GET", url: "/api/audiobooks", headers: { cookie, "x-profile-id": String(freshId) } });
    const books = res.json() as { progress: unknown }[];
    // Not an empty list: a profile that holds no books would pass this
    // vacuously.
    expect(books.length).toBeGreaterThan(0);
    expect(books.every((book) => book.progress === null)).toBe(true);
  });
});

describe("sessions", () => {
  it("records a listening session", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/audiobooks/${bookId}/sessions`,
      payload: { fromPosition: 100, toPosition: 400, speed: 1.5 },
      headers: profileHeaders(),
    });
    expect(res.statusCode).toBe(201);
    const history = await app.inject({ method: "GET", url: "/api/history", headers: profileHeaders() });
    expect(history.json()).toHaveLength(1);
    expect(history.json()[0]).toMatchObject({ fromPosition: 100, toPosition: 400, speed: 1.5 });
  });

  it("rejects sessions missing positions", async () => {
    const res = await app.inject({ method: "POST", url: `/api/audiobooks/${bookId}/sessions`, payload: {}, headers: profileHeaders() });
    expect(res.statusCode).toBe(400);
  });

  it("keeps stored session positions and speed within sane bounds", async () => {
    // A synthetic save during a track switch could report a position past the
    // end of the book, and a nonsense rate must not be stored verbatim.
    const res = await app.inject({
      method: "POST",
      url: `/api/audiobooks/${bookId}/sessions`,
      payload: { fromPosition: -20, toPosition: 99999, speed: 1e9 },
      headers: profileHeaders(),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ fromPosition: 0, toPosition: 1000, speed: 10 });
  });

  it("falls back to a sane speed when none is given", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/audiobooks/${bookId}/sessions`,
      payload: { fromPosition: 0, toPosition: 10 },
      headers: profileHeaders(),
    });
    expect(res.json().speed).toBe(1);
  });
});
