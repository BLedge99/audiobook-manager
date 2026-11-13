import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import Fastify from "fastify";
import { buildApp, SESSION_HEADER } from "./app";
import { createTestDatabase } from "./test-support/database";

const db = createTestDatabase("audiobook-test-");

let app: Awaited<ReturnType<typeof buildApp>>;
// Only for arranging rows the API cannot create itself -- books arrive via a
// filesystem scan, which is not something these route tests should drive.
let prisma: PrismaClient;

beforeAll(async () => {
  prisma = new PrismaClient();
  app = await buildApp({ logger: false, appPassword: "household", prisma });
}, 120_000);

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  db.cleanup();
});

describe("same-origin admin proxy", () => {
  it("registers no admin route when the proxy is not configured (ADR 029)", async () => {
    // The household/default wiring: index.ts only passes adminProxyTarget
    // when ADMIN_PROXY=true (the hosted single-port deployment). Without it
    // the family listener has no admin surface at all.
    expect((await app.inject({ method: "GET", url: "/admin" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/admin/" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/admin/login" })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/api/admin/login", payload: { password: "x" } })).statusCode).toBe(404);
  });

  it("forwards the panel and admin API without using family authentication", async () => {
    const adminStub = Fastify();
    adminStub.get("/", async () => ({ panel: "admin" }));
    adminStub.post<{ Body: { password: string } }>("/api/admin/login", async (request, reply) => {
      expect(request.body).toEqual({ password: "admin-secret" });
      return reply.header("set-cookie", "admin_panel_session=token; Path=/; HttpOnly").send({ ok: true });
    });
    const address = await adminStub.listen({ port: 0, host: "127.0.0.1" });
    const proxyApp = await buildApp({
      logger: false,
      prisma,
      appPassword: "household",
      adminProxyTarget: address,
    });
    try {
      const redirect = await proxyApp.inject({ method: "GET", url: "/admin" });
      expect(redirect.statusCode).toBe(302);
      expect(redirect.headers.location).toBe("/admin/");
      const panel = await proxyApp.inject({ method: "GET", url: "/admin/" });
      expect(panel.statusCode).toBe(200);
      expect(panel.json()).toEqual({ panel: "admin" });

      const login = await proxyApp.inject({
        method: "POST",
        url: "/api/admin/login",
        payload: { password: "admin-secret" },
      });
      expect(login.statusCode).toBe(200);
      expect(login.json()).toEqual({ ok: true });
      expect(login.headers["set-cookie"]?.toString()).toContain("admin_panel_session=token");
    } finally {
      await proxyApp.close();
      await adminStub.close();
    }
  });
});

describe("auth gate", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await app.inject({ method: "GET", url: "/api/audiobooks" });
    expect(res.statusCode).toBe(401);
    // A code, not prose: the client owns the sentence (ADR 015).
    expect(res.json()).toEqual({ code: "auth_required" });
  });

  it("rejects a wrong password", async () => {
    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "nope" } });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: "incorrect_password" });
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

  it("does not accept a long-lived session token from a URL", async () => {
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "household" } });
    const { token } = login.json<{ token: string }>();
    const res = await app.inject({ method: "GET", url: `/api/audiobooks?session=${token}` });
    expect(res.statusCode).toBe(401);
  });

  it("ignores an unrelated query parameter when authenticating", async () => {
    // Guards against the gate being loosened into "any query parameter is a
    // token", which would be trivially bypassable.
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "household" } });
    const { token } = login.json<{ token: string }>();
    const res = await app.inject({ method: "GET", url: `/api/audiobooks?ignored=${token}` });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a media query parameter on non-media endpoints", async () => {
    const res = await app.inject({ method: "GET", url: "/api/audiobooks?media=not-a-real-token" });
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

  it("allows Android WebView preflights for library membership removal", async () => {
    const res = await app.inject({
      method: "OPTIONS",
      url: "/api/audiobooks/1/library",
      headers: {
        origin: "http://localhost",
        "access-control-request-method": "DELETE",
        "access-control-request-headers": SESSION_HEADER,
      },
    });

    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost");
    expect(res.headers["access-control-allow-methods"]).toContain("DELETE");
    expect(res.headers["access-control-allow-headers"]).toContain(SESSION_HEADER);
  });

  it("allows the exact production HTTPS origin for passkeys", async () => {
    const res = await app.inject({
      method: "GET", url: "/api/health", headers: { origin: "https://books.home.arpa" },
    });
    expect(res.headers["access-control-allow-origin"]).toBe("https://books.home.arpa");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
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

describe("the API error contract", () => {
  async function authed() {
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "household" } });
    return login.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  }

  it("sends a code, not prose", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/audiobooks/1/library",
      headers: { cookie: await authed() },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ code: "profile_required" });
  });

  it("carries the values a sentence needs as params", async () => {
    // A reserved name is rejected by the tag validator. The reason travels as
    // data so the client can say it in its own words.
    const res = await app.inject({
      method: "POST",
      url: "/api/tags",
      headers: { cookie: await authed() },
      payload: { name: "discover" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ code: "tag_name_rejected", params: { reason: "reserved" } });
  });
});

describe("oauth flow routes", () => {
  let oauthApp: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    oauthApp = await buildApp({
      logger: false,
      appPassword: "household",
      prisma,
      oauth: {
        enabled: true,
        providers: [
          {
            id: "google",
            clientId: "google-client-id",
            clientSecret: "google-client-secret",
            authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
            tokenUrl: "https://oauth2.googleapis.com/token",
            userInfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
            scope: "openid profile email",
            issuer: "https://accounts.google.com",
          },
        ],
      },
    });
  }, 120_000);

  afterAll(async () => {
    await oauthApp.close();
  });

  it("redirects to the provider authorize endpoint with pkce and state", async () => {
    const res = await oauthApp.inject({ method: "GET", url: "/api/auth/google/authorize" });
    expect(res.statusCode).toBe(302);
    const location = res.headers["location"];
    expect(typeof location).toBe("string");
    expect(location).toContain("https://accounts.google.com/o/oauth2/v2/auth");
    expect(location).toContain("response_type=code");
    expect(location).toContain("client_id=google-client-id");
    expect(location).toContain("code_challenge=");
    expect(location).toContain("code_challenge_method=S256");
    expect(location).toContain("state=");
  });

  it("answers a callback without a valid state cookie with oauth_state_mismatch", async () => {
    const res = await oauthApp.inject({
      method: "GET",
      url: "/api/auth/google/callback?code=abc&state=xyz",
      headers: { cookie: "oauth_state=wrong; oauth_code_verifier=verifier" },
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/?auth_error=oauth_state_mismatch");
  });

  it("throttles repeated failed callbacks per IP with oauth_rate_limited", async () => {
    // OAUTH_MAX_ATTEMPTS failed callbacks each record a failure; the next one is
    // answered with the rate-limit error instead of touching the provider again.
    // (One failure was already recorded by the state-mismatch test above.)
    for (let attempt = 0; attempt < 9; attempt += 1) {
      const res = await oauthApp.inject({
        method: "GET",
        url: "/api/auth/google/callback?code=abc&state=xyz",
        headers: { cookie: "oauth_state=wrong; oauth_code_verifier=verifier" },
      });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe("/?auth_error=oauth_state_mismatch");
    }
    const throttled = await oauthApp.inject({
      method: "GET",
      url: "/api/auth/google/callback?code=abc&state=xyz",
      headers: { cookie: "oauth_state=wrong; oauth_code_verifier=verifier" },
    });
    expect(throttled.statusCode).toBe(302);
    expect(throttled.headers.location).toBe("/?auth_error=oauth_rate_limited");
  });
});

describe("native oauth flow", () => {
  let nativeApp: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    nativeApp = await buildApp({
      logger: false,
      appPassword: "household",
      prisma,
      oauth: {
        enabled: true,
        providers: [
          {
            id: "google",
            clientId: "google-client-id",
            clientSecret: "google-client-secret",
            authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
            tokenUrl: "https://oauth2.googleapis.com/token",
            userInfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
            scope: "openid profile email",
            issuer: "https://accounts.google.com",
          },
        ],
      },
    });
  }, 120_000);

  afterAll(async () => {
    await nativeApp.close();
    vi.unstubAllGlobals();
  });

  beforeEach(async () => {
    // Handoff rows persist until the 60-second sweep; wipe them so a leftover
    // row from the round-trip test cannot satisfy the count in another test.
    await prisma.oAuthHandoff.deleteMany();
  });

  const state = "ab".repeat(64);

  function googleOkFetch() {
    return vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "google-access-token", token_type: "Bearer" }), { status: 200 });
      }
      if (url.includes("userinfo")) {
        return new Response(
          JSON.stringify({ sub: "google-sub-native", email: "native@example.com", email_verified: true, name: "Native User" }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
  }

  it("authorize with client=native keeps the provider leg and memorises the app state", async () => {
    const res = await nativeApp.inject({
      method: "GET",
      url: `/api/auth/google/authorize?client=native&state=${state}`,
    });
    expect(res.statusCode).toBe(302);
    const location = res.headers.location as string;
    expect(location).toContain("https://accounts.google.com/o/oauth2/v2/auth");
    expect(location).toContain("response_type=code");
    expect(location).toContain("code_challenge=");
    const cookies = ([] as string[]).concat((res.headers["set-cookie"] as string | string[]) ?? []);
    expect(cookies.some((c) => c.startsWith(`oauth_app_state=${state}`))).toBe(true);
    expect(cookies.some((c) => c.startsWith("oauth_state="))).toBe(true);
    expect(cookies.some((c) => c.startsWith("oauth_code_verifier="))).toBe(true);
    expect(await prisma.oAuthHandoff.count()).toBe(0);
  });

  it("authorize rejects a bogus client value with 400", async () => {
    const res = await nativeApp.inject({ method: "GET", url: "/api/auth/google/authorize?client=bogus&state=abc" });
    expect(res.statusCode).toBe(400);
  });

  it("authorize rejects a native state that is missing, empty or oversized with 400", async () => {
    for (const url of [
      "/api/auth/google/authorize?client=native",
      "/api/auth/google/authorize?client=native&state=",
      `/api/auth/google/authorize?client=native&state=${"x".repeat(129)}`,
    ]) {
      const res = await nativeApp.inject({ method: "GET", url });
      expect(res.statusCode).toBe(400);
    }
  });

  it("full native round trip: deep-links, creates the handoff, no session cookie, then exchanges", async () => {
    vi.stubGlobal("fetch", googleOkFetch());

    const authorize = await nativeApp.inject({
      method: "GET",
      url: `/api/auth/google/authorize?client=native&state=${state}`,
    });
    const authorizeCookies = ([] as string[]).concat((authorize.headers["set-cookie"] as string | string[]) ?? []);
    const cookieHeader = authorizeCookies.map((c) => c.split(";")[0]).join("; ");
    const providerState = /oauth_state=([^;]+)/.exec(cookieHeader)?.[1];
    expect(providerState).toBeTruthy();

    const callback = await nativeApp.inject({
      method: "GET",
      url: `/api/auth/google/callback?code=fake-code&state=${providerState}`,
      headers: { cookie: cookieHeader },
    });
    expect(callback.statusCode).toBe(302);
    const location = callback.headers.location as string;
    expect(location.startsWith("com.technative.audiobookmanager://oauth/callback?")).toBe(true);
    const params = new URLSearchParams(location.split("?")[1]);
    expect(params.get("state")).toBe(state);
    expect(params.get("code")).toBeTruthy();
    const callbackCookies = ([] as string[]).concat((callback.headers["set-cookie"] as string | string[]) ?? []);
    expect(callbackCookies.some((c) => c.startsWith("house_session="))).toBe(false);

    // The callback must create exactly one handoff, hashed, tied to the app state.
    const rows = await prisma.oAuthHandoff.findMany();
    expect(rows).toHaveLength(1);

    // And the app can exchange it for a working session (spec 32, criterion A5).
    const exchange = await nativeApp.inject({
      method: "POST",
      url: "/api/auth/oauth/handoff",
      payload: { code: params.get("code")!, state },
    });
    expect(exchange.statusCode).toBe(200);
    expect(exchange.json().token).toBeTruthy();
    expect((await prisma.oAuthHandoff.findMany())[0].consumedAt).not.toBeNull();

    vi.unstubAllGlobals();
  });

  it("callback in native mode with a failed provider exchange deep-links with auth_error and creates no handoff", async () => {
    const res = await nativeApp.inject({
      method: "GET",
      url: "/api/auth/google/callback?code=abc&state=xyz",
      headers: { cookie: `oauth_app_state=${state}; oauth_state=wrong; oauth_code_verifier=verifier` },
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("com.technative.audiobookmanager://oauth/callback?auth_error=oauth_state_mismatch");
    expect(await prisma.oAuthHandoff.count()).toBe(0);
  });

  it("web flow is unchanged: session cookie set and redirect to /, no handoff created", async () => {
    vi.stubGlobal("fetch", googleOkFetch());

    const authorize = await nativeApp.inject({ method: "GET", url: "/api/auth/google/authorize" });
    const authorizeCookies = ([] as string[]).concat((authorize.headers["set-cookie"] as string | string[]) ?? []);
    const cookieHeader = authorizeCookies.map((c) => c.split(";")[0]).join("; ");
    const providerState = /oauth_state=([^;]+)/.exec(cookieHeader)?.[1];

    const callback = await nativeApp.inject({
      method: "GET",
      url: `/api/auth/google/callback?code=fake-code&state=${providerState}`,
      headers: { cookie: cookieHeader },
    });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe("/");
    const callbackCookies = ([] as string[]).concat((callback.headers["set-cookie"] as string | string[]) ?? []);
    expect(callbackCookies.some((c) => c.startsWith("house_session="))).toBe(true);
    expect(await prisma.oAuthHandoff.count()).toBe(0);

    vi.unstubAllGlobals();
  });
});

describe("production demo account policy", () => {
  let demoApp: Awaited<ReturnType<typeof buildApp>>;
  let firstProfileId: number;
  let otherProfileId: number;

  beforeAll(async () => {
    const suffix = Date.now().toString(36);
    const first = await prisma.profile.create({ data: { name: `demo-a-${suffix}` } });
    const other = await prisma.profile.create({ data: { name: `demo-b-${suffix}` } });
    firstProfileId = first.id;
    otherProfileId = other.id;
    demoApp = await buildApp({
      logger: false,
      appPassword: "household",
      prisma,
      accountExperience: "demo",
    });
  }, 120_000);

  afterAll(async () => {
    await demoApp.close();
    await prisma.profile.deleteMany({ where: { id: { in: [firstProfileId, otherProfileId] } } });
  });

  it("advertises demo mode and hides profile lists and management endpoints", async () => {
    const config = (await demoApp.inject({ method: "GET", url: "/api/config" })).json();
    expect(config.accountExperience).toBe("demo");
    expect(Array.isArray(config.oauthProviders)).toBe(true);
    expect((await demoApp.inject({ method: "GET", url: "/api/profiles" })).statusCode).toBe(401);
    expect((await demoApp.inject({ method: "GET", url: "/api/auth/accounts" })).statusCode).toBe(404);
    const signup = await demoApp.inject({ method: "POST", url: "/api/auth/signup", payload: { email: `demo-${Date.now()}@example.test`, password: "long-enough-demo-pass-9" } });
    expect(signup.statusCode).toBe(200);
    expect(signup.json()).not.toHaveProperty("profile.id");
    expect(signup.json()).not.toHaveProperty("profile.name");
    const cookie = signup.cookies.map((entry) => `${entry.name}=${entry.value}`).join("; ");
    const session = await demoApp.inject({ method: "GET", url: "/api/auth/session", headers: { cookie } });
    expect(session.statusCode).toBe(200);
    expect(session.json()).not.toHaveProperty("profile.id");
    expect(session.json()).not.toHaveProperty("profile.name");
    expect((await demoApp.inject({ method: "POST", url: "/api/auth/passkeys/login/options", payload: {} })).statusCode).toBe(404);
    expect((await demoApp.inject({ method: "POST", url: "/api/auth/devices/session", payload: { secret: "some-long-device-secret-value" } })).statusCode).toBe(404);
    expect((await demoApp.inject({ method: "GET", url: "/api/enrichment/status", headers: { cookie } })).statusCode).toBe(404);
    expect((await demoApp.inject({ method: "GET", url: "/api/library-roots", headers: { cookie } })).statusCode).toBe(404);
    const scopes = await Promise.all([
      demoApp.inject({ method: "GET", url: "/api/audiobooks", headers: { cookie, "x-profile-id": String(otherProfileId) } }),
      demoApp.inject({ method: "GET", url: "/api/server-library", headers: { cookie, "x-profile-id": String(otherProfileId) } }),
      demoApp.inject({ method: "GET", url: "/api/audiobooks/1/progress", headers: { cookie, "x-profile-id": String(otherProfileId) } }),
    ]);
    expect(scopes.map((result) => result.statusCode)).toEqual([200, 200, 200]);
    expect(scopes[2].json()).toEqual({ position: 0, completed: false });
    const sessionProfileId = session.json<{ profile?: { id?: number } }>().profile?.id;
    expect(sessionProfileId).toBeUndefined();
  });

  it("accepts the household password in demo mode without an account scope", async () => {
    const login = await demoApp.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "household" },
    });
    expect(login.statusCode).toBe(200);
    const body = login.json();
    expect(body.ok).toBe(true);
    expect(body.token).toBeDefined();
    expect(body.profile).toBeNull();
  });

  it("does not trust a forged x-profile-id for progress and does not serialize names in session info", async () => {
    const login = await demoApp.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { profileId: firstProfileId, password: "not-configured" },
    });
    // Demo mode does not provide profile-id/password sign-in. The follow-up
    // session assertions use an OAuth-created session in dedicated auth tests.
    expect(login.statusCode).toBe(404);
    const noSession = await demoApp.inject({
      method: "GET",
      url: "/api/audiobooks/1/progress",
      headers: { "x-profile-id": String(otherProfileId) },
    });
  });
});

describe("the route table", () => {
  it("registers exactly the routes it registered before the split", async () => {
    const docs = (app as unknown as { apiDocs: { method: string | string[]; url: string }[] }).apiDocs;
    const routes: string[] = [];
    for (const route of docs) {
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      for (const method of methods) routes.push(`${method} ${route.url}`);
    }
    // Non-API routes are not collected by the onRoute hook inside buildApp.
    routes.push("GET /privacy");
    expect(routes.sort()).toEqual([
      "DELETE /api/admin",
      "DELETE /api/admin/*",
      "DELETE /api/audiobooks/:id/favourite",
      "DELETE /api/audiobooks/:id/library",
      "DELETE /api/auth/devices/:id",
      "DELETE /api/auth/passkeys/:id",
      "DELETE /api/auth/sessions/:id",
      "DELETE /api/auth/sessions/device/:key",
      "DELETE /api/auth/sessions/others",
      "DELETE /api/genres/:id",
      "DELETE /api/library-roots/:id",
      "DELETE /api/me",
      "DELETE /api/me/favourites/:mediaItemId",
      "DELETE /api/me/listening-history/:historyId",
      "DELETE /api/profiles/:id",
      "DELETE /api/tags/:id",
      "DELETE /api/wishlist/:id",
      "GET /api/admin",
      "GET /api/admin/*",
      "GET /api/audiobooks",
      "GET /api/audiobooks/:id",
      "GET /api/audiobooks/:id/candidates",
      "GET /api/audiobooks/:id/cover",
      "GET /api/audiobooks/:id/progress",
      "GET /api/audiobooks/:id/stream",
      "GET /api/audiobooks/:id/tags",
      "GET /api/auth/:provider/authorize",
      "GET /api/auth/:provider/callback",
      "GET /api/auth/accounts",
      "GET /api/auth/devices",
      "GET /api/auth/passkeys",
      "GET /api/auth/providers",
      "GET /api/auth/session",
      "GET /api/auth/sessions",
      "GET /api/buy-context",
      "GET /api/config",
      "GET /api/discover/for-me",
      "GET /api/discover/similar/:id",
      "GET /api/enrichment/review-queue",
      "GET /api/enrichment/status",
      "GET /api/favourites",
      "GET /api/favourites/ids",
      "GET /api/genres",
      "GET /api/health",
      "GET /api/history",
      "GET /api/library-roots",
      "GET /api/me/export",
      "GET /api/profiles",
      "GET /api/scan/status",
      "GET /api/server-library",
      "GET /api/tags",
      "GET /api/tracks/:id/stream",
      "GET /api/wishlist",
      "GET /privacy",
      "HEAD /api/admin",
      "HEAD /api/admin/*",
      "HEAD /api/audiobooks",
      "HEAD /api/audiobooks/:id",
      "HEAD /api/audiobooks/:id/candidates",
      "HEAD /api/audiobooks/:id/cover",
      "HEAD /api/audiobooks/:id/progress",
      "HEAD /api/audiobooks/:id/stream",
      "HEAD /api/audiobooks/:id/tags",
      "HEAD /api/auth/:provider/authorize",
      "HEAD /api/auth/:provider/callback",
      "HEAD /api/auth/accounts",
      "HEAD /api/auth/devices",
      "HEAD /api/auth/passkeys",
      "HEAD /api/auth/providers",
      "HEAD /api/auth/session",
      "HEAD /api/auth/sessions",
      "HEAD /api/buy-context",
      "HEAD /api/config",
      "HEAD /api/discover/for-me",
      "HEAD /api/discover/similar/:id",
      "HEAD /api/enrichment/review-queue",
      "HEAD /api/enrichment/status",
      "HEAD /api/favourites",
      "HEAD /api/favourites/ids",
      "HEAD /api/genres",
      "HEAD /api/health",
      "HEAD /api/history",
      "HEAD /api/library-roots",
      "HEAD /api/me/export",
      "HEAD /api/profiles",
      "HEAD /api/scan/status",
      "HEAD /api/server-library",
      "HEAD /api/tags",
      "HEAD /api/tracks/:id/stream",
      "HEAD /api/wishlist",
      "OPTIONS /api/admin",
      "OPTIONS /api/admin/*",
      "PATCH /api/admin",
      "PATCH /api/admin/*",
      "PATCH /api/genres/:id",
      "PATCH /api/me",
      "PATCH /api/tags/:id",
      "POST /api/admin",
      "POST /api/admin/*",
      "POST /api/audiobooks/:id/ai-suggest",
      "POST /api/audiobooks/:id/enrich",
      "POST /api/audiobooks/:id/library",
      "POST /api/audiobooks/:id/metadata",
      "POST /api/audiobooks/:id/metadata/reset",
      "POST /api/audiobooks/:id/sessions",
      "POST /api/auth/accounts/:id/reset",
      "POST /api/auth/accounts/:id/unlock",
      "POST /api/auth/claim",
      "POST /api/auth/devices",
      "POST /api/auth/devices/link",
      "POST /api/auth/devices/session",
      "POST /api/auth/login",
      "POST /api/auth/logout",
      "POST /api/auth/media-token",
      "POST /api/auth/oauth/handoff",
      "POST /api/auth/passkeys/login/options",
      "POST /api/auth/passkeys/login/verify",
      "POST /api/auth/passkeys/register/options",
      "POST /api/auth/passkeys/register/verify",
      "POST /api/auth/password",
      "POST /api/auth/register-profile",
      "POST /api/auth/signup",
      "POST /api/enrichment/run",
      "POST /api/genres",
      "POST /api/library-roots",
      "POST /api/metadata/reset-all",
      "POST /api/profiles",
      "POST /api/scan",
      "POST /api/tags",
      "POST /api/tags/:id/merge",
      "POST /api/wishlist",
      "PUT /api/admin",
      "PUT /api/admin/*",
      "PUT /api/audiobooks/:id/favourite",
      "PUT /api/audiobooks/:id/progress",
      "PUT /api/audiobooks/:id/tags",
      "PUT /api/audiobooks/:id/tracks/:trackNumber/title",
      "PUT /api/wishlist/:id/owned",
    ]);
  });

  it("declares a schema on every mutating route that accepts input", () => {
    const docs = (app as unknown as {
      apiDocs: { method: string | string[]; url: string; schema?: Record<string, unknown> }[];
    }).apiDocs;
    // No client input: nothing to validate. The admin proxy routes forward
    // arbitrary bodies to the admin listener, which validates there.
    const NO_INPUT = new Set([
      // No input at all: nothing to validate.
      "POST /api/auth/logout",
      "POST /api/auth/passkeys/register/options",
      "DELETE /api/auth/sessions/others",
      "POST /api/metadata/reset-all",
      "DELETE /api/me",
      // The admin proxy forwards arbitrary bodies to the admin listener,
      // which validates there.
      "POST /api/admin",
      "PUT /api/admin",
      "PATCH /api/admin",
      "DELETE /api/admin",
      "POST /api/admin/*",
      "PUT /api/admin/*",
      "PATCH /api/admin/*",
      "DELETE /api/admin/*",
    ]);
    const byMethod = (route: { method: string | string[] }) =>
      (Array.isArray(route.method) ? route.method : [route.method]);
    const missing = docs
      .flatMap((route) => byMethod(route).map((method) => ({ method, url: route.url, schema: route.schema })))
      .filter(({ method }) => ["POST", "PUT", "PATCH", "DELETE"].includes(method))
      .filter(({ method, url }) => !NO_INPUT.has(`${method} ${url}`))
      .filter(({ schema }) => !schema || Object.keys(schema).length === 0)
      .map(({ method, url }) => `${method} ${url}`);
    expect(missing.sort()).toEqual([]);
  });
});

describe("media streaming content types and caching", () => {
  async function authed() {
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "household" } });
    return { cookie: login.cookies.map((c) => `${c.name}=${c.value}`).join("; ") };
  }

  async function seedBookWithFile(ext: string) {
    const dir = mkdtempSync(path.join(tmpdir(), `stream-${ext.slice(1)}-`));
    const filePath = path.join(dir, `book${ext}`);
    writeFileSync(filePath, Buffer.from("fake audio bytes"));
    const root = await prisma.libraryRoot.create({ data: { path: dir, label: `Stream ${ext}` } });
    const item = await prisma.mediaItem.create({
      data: {
        libraryRootId: root.id,
        filePath,
        title: `Stream ${ext}`,
        author: "Unknown",
        fileFormat: ext.slice(1),
        duration: 10,
      },
    });
    return { item };
  }

  it.each([
    [".mp3", "audio/mpeg"],
    [".m4b", "audio/mp4"],
    [".m4a", "audio/mp4"],
    [".flac", "audio/flac"],
    [".ogg", "audio/ogg"],
    [".opus", "audio/ogg"],
  ])("serves a %s file as %s", async (ext, expected) => {
    const { cookie } = await authed();
    const { item } = await seedBookWithFile(ext);
    const res = await app.inject({ method: "GET", url: `/api/audiobooks/${item.id}/stream`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe(expected);
  });

  it("answers 206 with the same content type for a range request", async () => {
    const { cookie } = await authed();
    const { item } = await seedBookWithFile(".m4b");
    const res = await app.inject({
      method: "GET",
      url: `/api/audiobooks/${item.id}/stream`,
      headers: { cookie, range: "bytes=0-3" },
    });
    expect(res.statusCode).toBe(206);
    expect(res.headers["content-type"]).toBe("audio/mp4");
    expect(res.headers["content-range"]).toBe("bytes 0-3/16");
  });

  it("caches streams privately for an hour instead of revalidating every hit", async () => {
    const { cookie } = await authed();
    const { item } = await seedBookWithFile(".mp3");
    const res = await app.inject({ method: "GET", url: `/api/audiobooks/${item.id}/stream`, headers: { cookie } });
    expect(res.headers["cache-control"]).toBe("private, max-age=3600");
  });
});
