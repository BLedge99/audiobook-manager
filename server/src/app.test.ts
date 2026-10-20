import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { buildApp, SESSION_HEADER } from "./app";

const dir = mkdtempSync(path.join(tmpdir(), "audiobook-test-"));
const dbFile = path.join(dir, "test.db");
process.env.DATABASE_URL = `file:${dbFile}`;

let app: Awaited<ReturnType<typeof buildApp>>;
// Only for arranging rows the API cannot create itself -- books arrive via a
// filesystem scan, which is not something these route tests should drive.
const prisma = new PrismaClient();

beforeAll(async () => {
  execSync("npx prisma migrate deploy", {
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

  it("allows authenticated access with the session header, for the Android shell", async () => {
    // The Android WebView is cross-site relative to a plain-HTTP API, so Chrome
    // drops the SameSite=Lax cookie entirely. The token is therefore also
    // returned in the login body and replayed as a header. Verified on device:
    // with the cookie alone, login returned 200 and every later call 401'd.
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "household" } });
    const { token } = login.json<{ token: string }>();
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);

    const res = await app.inject({
      method: "GET",
      url: "/api/audiobooks",
      headers: { [SESSION_HEADER]: token, origin: "https://localhost" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("rejects a bad or missing session header", async () => {
    const res = await app.inject({ method: "GET", url: "/api/audiobooks", headers: { [SESSION_HEADER]: "not-a-real-token" } });
    expect(res.statusCode).toBe(401);
  });

  it("invalidates the session header on logout", async () => {
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "household" } });
    const { token } = login.json<{ token: string }>();
    await app.inject({ method: "POST", url: "/api/auth/logout", headers: { [SESSION_HEADER]: token } });
    const res = await app.inject({ method: "GET", url: "/api/audiobooks", headers: { [SESSION_HEADER]: token } });
    expect(res.statusCode).toBe(401);
  });

  it("authenticates from a session query parameter, for <audio src> requests", async () => {
    // An <audio src> request is issued by the browser, not by script, so it
    // cannot carry the session header. Without accepting the token in the URL,
    // streaming playback cannot authenticate at all -- observed on device as
    // "playback could not start" while every fetch() call worked.
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "household" } });
    const { token } = login.json<{ token: string }>();
    const res = await app.inject({ method: "GET", url: `/api/audiobooks?session=${token}` });
    expect(res.statusCode).toBe(200);
  });

  it("ignores an unrelated query parameter when authenticating", async () => {
    // Guards against the gate being loosened into "any query parameter is a
    // token", which would be trivially bypassable.
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "household" } });
    const { token } = login.json<{ token: string }>();
    const res = await app.inject({ method: "GET", url: `/api/audiobooks?ignored=${token}` });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a bad session query parameter", async () => {
    const res = await app.inject({ method: "GET", url: "/api/audiobooks?session=not-a-real-token" });
    expect(res.statusCode).toBe(401);
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

  it("allows the Capacitor WebView origin under BOTH schemes", async () => {
    // `capacitor.config.ts` sets `androidScheme: "http"` so that a plain-HTTP LAN
    // address is same-scheme instead of mixed content (decisions/014). That moves
    // the app's origin from `https://localhost` to `http://localhost`.
    //
    // CORS compares the origin whole, so changing the scheme without adding the
    // other entry breaks every API call on the device -- and it breaks *silently*:
    // the browser rejects it as CORS, which surfaces in the app as a bare
    // `TypeError: Failed to fetch` with no mention of CORS anywhere.
    //
    // This is a regression that actually happened, on a real phone, after the
    // scheme fix looked complete. Hence both are asserted.
    for (const origin of ["http://localhost", "https://localhost"]) {
      const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "household" } });
      const cookieHeader = login.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
      const res = await app.inject({
        method: "GET",
        url: "/api/audiobooks",
        headers: { cookie: cookieHeader, origin },
      });
      expect(res.statusCode, `origin ${origin}`).toBe(200);
      expect(res.headers["access-control-allow-origin"], `origin ${origin}`).toBe(origin);
    }
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
 * Spec 15b feature 4 — the conditional library GET.
 *
 * The tag is hashed over the whole payload rather than over a hand-picked set
 * of `updatedAt` columns, because the response mixes `MediaItem` columns, four
 * join tables and the caller's own progress. The test that matters most is the
 * one that proves a genre applied *after* the last rescan still invalidates the
 * tag: that is precisely the case a timestamp-based tag would get wrong.
 */
describe("conditional library GET", () => {
  async function authed() {
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "household" } });
    return { cookie: login.cookies.map((c) => `${c.name}=${c.value}`).join("; ") };
  }

  async function seedBook(title: string) {
    const root =
      (await prisma.libraryRoot.findFirst()) ??
      (await prisma.libraryRoot.create({ data: { path: "/lib", label: "Test" } }));
    const item = await prisma.mediaItem.create({
      data: { libraryRootId: root.id, filePath: `/lib/etag-${Date.now()}-${title}`, title, author: "Unknown", fileFormat: "mp3", duration: 300 },
    });
    // A real book always has tracks, and a track always has a `sizeBytes`
    // BigInt that `publicMediaItem` does not strip. Hashing the payload without
    // a BigInt-safe replacer threw `Do not know how to serialize a BigInt` and
    // 500'd every library request -- a bug no fixture without tracks could see.
    await prisma.track.create({
      data: {
        mediaItemId: item.id,
        filePath: `/lib/etag-${item.id}/track-1.mp3`,
        title: "Section 01",
        duration: 300,
        trackNumber: 1,
        sizeBytes: 12_345_678n,
      },
    });
    return item;
  }

  it("sends an ETag and a revalidating cache directive", async () => {
    const { cookie } = await authed();
    await seedBook("ETag Basics");
    const res = await app.inject({ method: "GET", url: "/api/audiobooks", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers.etag).toMatch(/^"[0-9a-f]+"$/);
    // `no-cache`, not `no-store`: the client may keep the body but must
    // revalidate. `no-store` would throw away the thing this feature buys.
    expect(res.headers["cache-control"]).toBe("private, no-cache");
    expect(res.headers.vary).toContain("x-profile-id");
  });

  it("survives a track sizeBytes BigInt in the payload", async () => {
    // The regression this whole block needed: `Track.sizeBytes` is a Prisma
    // BigInt and reaches the payload, so hashing it with a bare JSON.stringify
    // threw and every library request 500'd. A fixture book with no tracks
    // cannot see it, which is why this test seeds a real track.
    const { cookie } = await authed();
    const item = await seedBook("ETag BigInt");
    const res = await app.inject({ method: "GET", url: "/api/audiobooks", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers.etag).toMatch(/^"[0-9a-f]+"$/);
    // The size must still be in the body the client receives.
    expect(res.json().find((book: { id: number }) => book.id === item.id).tracks[0].sizeBytes).toBeDefined();
  });

  it("gives two different track sizes two different tags", async () => {
    // Guards the reason the replacer emits a string rather than a Number: above
    // 2^53 two distinct BigInts become the same double, and equal tags would
    // serve a stale body.
    const { cookie } = await authed();
    const item = await seedBook("ETag BigInt Distinct");
    const first = await app.inject({ method: "GET", url: "/api/audiobooks", headers: { cookie } });
    await prisma.track.updateMany({
      where: { mediaItemId: item.id },
      data: { sizeBytes: 12_345_679n },
    });
    const second = await app.inject({
      method: "GET",
      url: "/api/audiobooks",
      headers: { cookie, "if-none-match": first.headers.etag as string },
    });
    expect(second.statusCode).toBe(200);
  });

  it("answers 304 with no body when nothing changed", async () => {
    const { cookie } = await authed();
    await seedBook("ETag Unchanged");
    const first = await app.inject({ method: "GET", url: "/api/audiobooks", headers: { cookie } });
    const second = await app.inject({
      method: "GET",
      url: "/api/audiobooks",
      headers: { cookie, "if-none-match": first.headers.etag as string },
    });
    expect(second.statusCode).toBe(304);
    expect(second.body).toBe("");
  });

  it("invalidates when a book changes", async () => {
    const { cookie } = await authed();
    const item = await seedBook("ETag Changes");
    const first = await app.inject({ method: "GET", url: "/api/audiobooks", headers: { cookie } });
    await prisma.mediaItem.update({ where: { id: item.id }, data: { title: "ETag Changes (edited)" } });
    const second = await app.inject({
      method: "GET",
      url: "/api/audiobooks",
      headers: { cookie, "if-none-match": first.headers.etag as string },
    });
    expect(second.statusCode).toBe(200);
  });

  it("invalidates when a join table changes, which no updatedAt column would catch", async () => {
    // The case that rules out hashing `MediaItem.updatedAt`: applying a genre
    // writes `MediaItemGenre` and touches no book column at all.
    const { cookie } = await authed();
    const item = await seedBook("ETag Join Table");
    const genre = await prisma.genre.create({ data: { slug: `etag-${Date.now()}`, name: "Etag Genre" } });
    const first = await app.inject({ method: "GET", url: "/api/audiobooks", headers: { cookie } });
    await prisma.mediaItemGenre.create({ data: { mediaItemId: item.id, genreId: genre.id, source: "test" } });
    const second = await app.inject({
      method: "GET",
      url: "/api/audiobooks",
      headers: { cookie, "if-none-match": first.headers.etag as string },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().find((book: { id: number }) => book.id === item.id).genres).toHaveLength(1);
  });

  it("never reuses one profile's tag for another's progress", async () => {
    // The reason the tag covers progress at all. Two listeners, one cached
    // response: if progress were not in the hash, profile B would receive a 304
    // and keep seeing profile A's bookmarks.
    const { cookie } = await authed();
    const item = await seedBook("ETag Progress");
    const a = await prisma.profile.create({ data: { name: `Etag A ${Date.now()}` } });
    const b = await prisma.profile.create({ data: { name: `Etag B ${Date.now()}` } });
    await prisma.listeningHistory.create({ data: { mediaItemId: item.id, profileId: a.id, position: 120 } });
    // Spec 27: the listing is scoped to the caller's membership, so both
    // profiles have to hold the book for the tag comparison to mean anything.
    // Without this the book would be missing from A's list rather than
    // carrying a different position, and the test would pass for the wrong
    // reason.
    await prisma.profileLibraryEntry.createMany({
      data: [
        { profileId: a.id, mediaItemId: item.id },
        { profileId: b.id, mediaItemId: item.id },
      ],
    });

    const forA = await app.inject({ method: "GET", url: "/api/audiobooks", headers: { cookie, "x-profile-id": String(a.id) } });
    expect(forA.json().find((book: { id: number }) => book.id === item.id).progress.position).toBe(120);

    // A's tag replayed as B's: the position differs, so this must not be a 304.
    const forB = await app.inject({
      method: "GET",
      url: "/api/audiobooks",
      headers: { cookie, "x-profile-id": String(b.id), "if-none-match": forA.headers.etag as string },
    });
    expect(forB.statusCode).toBe(200);
    expect(forB.json().find((book: { id: number }) => book.id === item.id).progress).toBeNull();
  });

  it("accepts a tag list and a wildcard", async () => {
    const { cookie } = await authed();
    const first = await app.inject({ method: "GET", url: "/api/audiobooks", headers: { cookie } });
    const tag = first.headers.etag as string;
    const list = await app.inject({
      method: "GET",
      url: "/api/audiobooks",
      headers: { cookie, "if-none-match": `"deadbeef", ${tag}` },
    });
    expect(list.statusCode).toBe(304);
    const wildcard = await app.inject({ method: "GET", url: "/api/audiobooks", headers: { cookie, "if-none-match": "*" } });
    expect(wildcard.statusCode).toBe(304);
  });

  it("ignores a tag that does not match", async () => {
    const { cookie } = await authed();
    const res = await app.inject({ method: "GET", url: "/api/audiobooks", headers: { cookie, "if-none-match": '"not-the-tag"' } });
    expect(res.statusCode).toBe(200);
  });

  it("serves a cover with an ETag, and answers 304 for the same bytes", async () => {
    // Spec 15b feature 1. The client caches covers on the device and
    // revalidates with If-None-Match, so the route has to be able to say
    // "unchanged" -- which for a file means mtime and size, not a hash.
    const { cookie } = await authed();
    const dir = mkdtempSync(path.join(tmpdir(), "cover-test-"));
    const file = path.join(dir, "cover.png");
    writeFileSync(file, Buffer.from("89504e470d0a1a0a", "hex"));
    // The cover must live inside a library root or COVER_DIR -- the path guard
    // answers 403 otherwise, which is spec 11 doing its job.
    const root = await prisma.libraryRoot.create({ data: { path: dir, label: "Cover ETag" } });
    const item = await prisma.mediaItem.create({
      data: {
        libraryRootId: root.id,
        filePath: path.join(dir, "etag-cover.mp3"),
        title: "ETag Cover",
        author: "Unknown",
        fileFormat: "mp3",
        duration: 10,
        coverImagePath: file,
      },
    });

    const first = await app.inject({ method: "GET", url: `/api/audiobooks/${item.id}/cover`, headers: { cookie } });
    expect(first.statusCode).toBe(200);
    expect(first.headers.etag).toMatch(/^"[0-9a-f]+"$/);
    expect(first.headers["cache-control"]).toBe("private, no-cache");
    // `immutable` would be a lie: an operator can re-enrich and change the art.
    expect(first.headers["cache-control"]).not.toContain("immutable");

    const again = await app.inject({
      method: "GET",
      url: `/api/audiobooks/${item.id}/cover`,
      headers: { cookie, "if-none-match": first.headers.etag as string },
    });
    expect(again.statusCode).toBe(304);

    // Rewriting the file must invalidate, or a changed cover would never
    // reach a device that had already seen the old one.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    writeFileSync(file, Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"));
    const changed = await app.inject({
      method: "GET",
      url: `/api/audiobooks/${item.id}/cover`,
      headers: { cookie, "if-none-match": first.headers.etag as string },
    });
    expect(changed.statusCode).toBe(200);
  });

  it("revalidates library roots separately, for scan state", async () => {
    // Scan state changes during a scan without any book changing, so the two
    // endpoints must not share one tag.
    const { cookie } = await authed();
    const first = await app.inject({ method: "GET", url: "/api/library-roots", headers: { cookie } });
    expect(first.headers.etag).toMatch(/^"[0-9a-f]+"$/);
    const second = await app.inject({
      method: "GET",
      url: "/api/library-roots",
      headers: { cookie, "if-none-match": first.headers.etag as string },
    });
    expect(second.statusCode).toBe(304);

    const books = await app.inject({ method: "GET", url: "/api/audiobooks", headers: { cookie } });
    const crossed = await app.inject({
      method: "GET",
      url: "/api/library-roots",
      headers: { cookie, "if-none-match": books.headers.etag as string },
    });
    expect(crossed.statusCode).toBe(200);
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
