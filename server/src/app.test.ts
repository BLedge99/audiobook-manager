import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "./app";

const dir = mkdtempSync(path.join(tmpdir(), "audiobook-test-"));
const dbFile = path.join(dir, "test.db");
process.env.DATABASE_URL = `file:${dbFile}`;

let app: Awaited<ReturnType<typeof buildApp>>;
// Only for arranging rows the API cannot create itself -- books arrive via a
// filesystem scan, which is not something these route tests should drive.
const prisma = new PrismaClient();

beforeAll(async () => {
  execSync("npx prisma db push --skip-generate", {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: `file:${dbFile}` },
    stdio: "ignore",
  });
  app = await buildApp({ logger: false, appPassword: "household" });
}, 120_000);

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  // Windows can still hold the SQLite handle briefly; a failed temp cleanup
  // must not fail an otherwise-green suite.
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

describe("auth gate", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await app.inject({ method: "GET", url: "/api/audiobooks" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a wrong password", async () => {
    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "nope" } });
    expect(res.statusCode).toBe(401);
  });

  it("accepts the household password and issues a session cookie", async () => {
    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "household" } });
    expect(res.statusCode).toBe(200);
    expect(res.cookies.find((c) => c.name === "house_session")).toBeTruthy();
  });

  it("allows authenticated access with the cookie", async () => {
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "household" } });
    const cookieHeader = login.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const res = await app.inject({ method: "GET", url: "/api/audiobooks", headers: { cookie: cookieHeader } });
    expect(res.statusCode).toBe(200);
  });

  it("allows the Capacitor WebView origin, so the Android app can call the API", async () => {
    // The Android app is served from an `https://localhost` origin, which makes
    // every LAN request genuinely cross-origin. Without this in the allow-list
    // the phone gets "No 'Access-Control-Allow-Origin' header is present" and
    // cannot reach the server at all.
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "household" } });
    const cookieHeader = login.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const res = await app.inject({
      method: "GET",
      url: "/api/audiobooks",
      headers: { cookie: cookieHeader, origin: "https://localhost" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("https://localhost");
  });

  it("sends Access-Control-Allow-Credentials, so the session cookie survives", async () => {
    // Auth is a cookie. A browser only accepts a cross-origin cookie when the
    // response carries Allow-Credentials alongside a specific origin, so
    // without this the Android app is allowed by origin but 401s on every call
    // and its login fails with no obvious cause.
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "household" },
      headers: { origin: "https://localhost" },
    });
    expect(login.statusCode).toBe(200);
    expect(login.headers["access-control-allow-credentials"]).toBe("true");
    expect(login.headers["access-control-allow-origin"]).toBe("https://localhost");
  });

  it("never pairs credentials with a wildcard origin", async () => {
    // `Access-Control-Allow-Origin: *` is illegal alongside credentials. If this
    // ever regressed to a wildcard the app would break *and* access would widen,
    // so assert the header is a specific origin rather than "*".
    const res = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { origin: "https://localhost" },
    });
    expect(res.headers["access-control-allow-origin"]).not.toBe("*");
  });

  it("still refuses a foreign web origin", async () => {
    // The other half of the same change: this commit widens CORS, so without
    // this test it would pass while quietly allowing every site on the
    // internet to call the household server.
    const res = await app.inject({
      method: "GET",
      url: "/api/audiobooks",
      headers: { origin: "https://evil.example" },
    });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("logout invalidates the session", async () => {
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "household" } });
    const cookieHeader = login.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie: cookieHeader } });
    const res = await app.inject({ method: "GET", url: "/api/audiobooks", headers: { cookie: cookieHeader } });
    expect(res.statusCode).toBe(401);
  });
});

describe("profiles", () => {
  it("creates, lists, and deletes profiles", async () => {
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "household" } });
    const cookieHeader = login.cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    const created = await app.inject({ method: "POST", url: "/api/profiles", payload: { name: "Sam", color: "cyan" }, headers: { cookie: cookieHeader } });
    expect(created.statusCode).toBe(201);
    const profileId = created.json().id;

    const list = await app.inject({ method: "GET", url: "/api/profiles", headers: { cookie: cookieHeader } });
    expect(list.json().map((p: { name: string }) => p.name)).toContain("Sam");

    const del = await app.inject({ method: "DELETE", url: `/api/profiles/${profileId}`, headers: { cookie: cookieHeader } });
    expect(del.statusCode).toBe(204);
  });

  it("rejects empty profile names", async () => {
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "household" } });
    const cookieHeader = login.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const res = await app.inject({ method: "POST", url: "/api/profiles", payload: { name: "  " }, headers: { cookie: cookieHeader } });
    expect(res.statusCode).toBe(400);
  });

  it("rejects duplicate profile names", async () => {
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "household" } });
    const cookieHeader = login.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    await app.inject({ method: "POST", url: "/api/profiles", payload: { name: "Sam" }, headers: { cookie: cookieHeader } });
    const dup = await app.inject({ method: "POST", url: "/api/profiles", payload: { name: "Sam" }, headers: { cookie: cookieHeader } });
    expect(dup.statusCode).toBe(409);
  });
});

/**
 * Spec 21 — setting a chapter title by hand.
 *
 * This is the endpoint that makes "a user-set track title is never overwritten"
 * enforceable, so the tests cover the paths that would silently defeat it: a
 * bad id, a missing track, and clearing (which must *remove* the override
 * rather than store an empty one that would block the scanner forever).
 */
describe("track title override", () => {
  async function authed() {
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "household" } });
    return { cookie: login.cookies.map((c) => `${c.name}=${c.value}`).join("; ") };
  }

  /**
   * Books only exist as a result of a filesystem scan, which these route tests
   * deliberately do not drive. So the fixture is arranged directly.
   */
  async function seedBook() {
    const headers = await authed();
    const root =
      (await prisma.libraryRoot.findFirst()) ??
      (await prisma.libraryRoot.create({ data: { path: "/lib", label: "Test" } }));
    const item = await prisma.mediaItem.create({
      data: {
        libraryRootId: root.id,
        filePath: `/lib/track-title-${Date.now()}`,
        title: "Track Title Test",
        author: "Unknown",
        fileFormat: "mp3",
        duration: 300,
      },
    });
    await prisma.track.create({
      data: { mediaItemId: item.id, filePath: `/lib/track-title/track-1.mp3`, title: "Section 01", duration: 100, trackNumber: 1 },
    });
    return { headers, bookId: item.id };
  }

  it("requires authentication", async () => {
    const res = await app.inject({ method: "PUT", url: "/api/audiobooks/1/tracks/1/title", payload: { title: "x" } });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a non-numeric book id", async () => {
    const { headers } = await seedBook();
    const res = await app.inject({ method: "PUT", url: "/api/audiobooks/abc/tracks/1/title", headers, payload: { title: "x" } });
    expect(res.statusCode).toBe(400);
  });

  it("404s an unknown book", async () => {
    const { headers } = await seedBook();
    const res = await app.inject({ method: "PUT", url: "/api/audiobooks/999999/tracks/1/title", headers, payload: { title: "x" } });
    expect(res.statusCode).toBe(404);
  });

  it("404s a track the book does not have", async () => {
    const { headers, bookId } = await seedBook();
    const res = await app.inject({ method: "PUT", url: `/api/audiobooks/${bookId}/tracks/7/title`, headers, payload: { title: "x" } });
    expect(res.statusCode).toBe(404);
  });

  it("stores the override and writes it to the track", async () => {
    const { headers, bookId } = await seedBook();
    const res = await app.inject({
      method: "PUT",
      url: `/api/audiobooks/${bookId}/tracks/1/title`,
      headers,
      payload: { title: "  Hand Written  " },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ overridden: true, title: "Hand Written", trackNumber: 1 });

    const track = await prisma.track.findFirstOrThrow({ where: { mediaItemId: bookId, trackNumber: 1 } });
    expect(track.title).toBe("Hand Written");
    const override = await prisma.fieldOverride.findFirstOrThrow({ where: { mediaItemId: bookId, field: "trackTitle:1" } });
    expect(override.value).toBe("Hand Written");
  });

  it("re-setting replaces the previous value rather than duplicating", async () => {
    const { headers, bookId } = await seedBook();
    for (const title of ["First", "Second"]) {
      await app.inject({ method: "PUT", url: `/api/audiobooks/${bookId}/tracks/1/title`, headers, payload: { title } });
    }
    const rows = await prisma.fieldOverride.findMany({ where: { mediaItemId: bookId, field: "trackTitle:1" } });
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe("Second");
  });

  it("clearing removes the override rather than storing an empty value", async () => {
    const { headers, bookId } = await seedBook();
    const set = await app.inject({ method: "PUT", url: `/api/audiobooks/${bookId}/tracks/1/title`, headers, payload: { title: "Hand Written" } });
    expect(set.statusCode).toBe(200);
    expect(set.json().overridden).toBe(true);

    const cleared = await app.inject({ method: "PUT", url: `/api/audiobooks/${bookId}/tracks/1/title`, headers, payload: { title: "" } });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().overridden).toBe(false);

    // An empty stored override would block the scanner from ever filling the
    // chapter in again, so the row must be gone rather than blank.
    const rows = await prisma.fieldOverride.findMany({ where: { mediaItemId: bookId, field: "trackTitle:1" } });
    expect(rows).toHaveLength(0);
  });
});
