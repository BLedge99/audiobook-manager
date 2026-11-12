/**
 * Spec 38 / ADR 033 — enforcement, end to end, against a temp database.
 *
 * One fixture per test: a child profile (age band configurable per test)
 * shelfed with every book on the fixture; the same books held by an adult
 * member where relevant.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { buildApp, SESSION_HEADER } from "../app";
import { hashPassword } from "../auth/password";
import { hashSessionToken, newSessionId, newSessionToken } from "../auth/session";
import { createTestDatabase } from "../test-support/database";

const db = createTestDatabase("audiobook-age-enforcement-");
const dir = db.dir;

let app: Awaited<ReturnType<typeof buildApp>>;
let prisma: PrismaClient;

// Book ratings on the ladder.
const R_PICTURE = 4;   // visible to every child band
const R_JUVENILE = 7;  // not for under-6; ok for 6-9+
const R_MATURE = 16;   // only 14-17

type Fixture = {
  childrenId: number;
  horrorId: number;
  bookA: number; // 4, genre children
  bookB: number; // 7, genre children
  bookC: number; // 16, genre horror
  bookD: number; // unrated, no genre
  bookE: number; // unrated, genre horror (blocklist-eligible)
};

async function createFixture(): Promise<Fixture> {
  const nonce = randomUUID().slice(0, 8);
  const root = await prisma.libraryRoot.create({ data: { path: `/test/age-enforcement-${nonce}`, label: "Age Fixture" } });
  const children = await prisma.genre.create({ data: { slug: `children-${nonce}`, name: "Children" } });
  const horror = await prisma.genre.create({ data: { slug: `horror-${nonce}`, name: "Horror" } });
  const mk = async (title: string, minimumAge: number | null, genreId: number | null) => {
    const item = await prisma.mediaItem.create({
      data: {
        title,
        author: "Fixture Author",
        filePath: `/test/age-enforcement-${nonce}/${title.replace(/\s+/g, "-")}.mp3`,
        fileFormat: "mp3",
        duration: 600,
        libraryRootId: root.id,
        minimumAge,
        genres: genreId ? { create: [{ genreId }] } : undefined,
      },
    });
    return item.id;
  };
  return {
    childrenId: children.id,
    horrorId: horror.id,
    bookA: await mk("Picture Start", R_PICTURE, children.id),
    bookB: await mk("Middle Passage", R_JUVENILE, children.id),
    bookC: await mk("Bitter Harvest", R_MATURE, null),
    bookD: await mk("Unrated Wonder", null, null),
    bookE: await mk("Unrated Horror", null, horror.id),
  };
}

async function createAccount(name: string, role: "child" | "member" | "admin", ageBand: string | null) {
  const nonce = randomUUID().slice(0, 8);
  const profile = await prisma.profile.create({
    data: {
      name: `${name}-${nonce}`,
      role,
      ageBand,
      passwordHash: await hashPassword("pw-" + name),
      passwordUpdatedAt: new Date(),
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

async function shelfEverything(profileId: number, books: number[]) {
  await prisma.profileLibraryEntry.createMany({
    data: books.map((mediaItemId) => ({ profileId, mediaItemId })),
  });
}

const asUser = (token: string) => ({ [SESSION_HEADER]: token });

beforeAll(async () => {
  prisma = new PrismaClient();
  app = await buildApp({ logger: false, appPassword: "household", mediaTokenSecret: "m".repeat(32), prisma });
}, 120_000);

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  db.cleanup();
});

describe("kids accounts — server-side enforcement (spec 38)", () => {
  it("child under-6 sees only unrated and ≤5-rated books; blocklisted unrated is hidden", async () => {
    const f = await createFixture();
    await prisma.blocklistGenre.create({ data: { genreId: f.horrorId } });

    const kid = await createAccount("kid-under-six", "child", "under-6");
    const mum = await createAccount("mum-member", "member", null);
    await shelfEverything(kid.id, [f.bookA, f.bookB, f.bookC, f.bookD, f.bookE]);
    await shelfEverything(mum.id, [f.bookA, f.bookB, f.bookC, f.bookD, f.bookE]);

    const kidRes = await app.inject({ method: "GET", url: "/api/audiobooks", headers: asUser(kid.token) });
    expect(kidRes.statusCode).toBe(200);
    const kidTitles = kidRes.json<Array<{ title: string }>>().map((b) => b.title).sort();
    expect(kidTitles).toEqual(["Picture Start", "Unrated Wonder"]);

    const mumRes = await app.inject({ method: "GET", url: "/api/audiobooks", headers: asUser(mum.token) });
    expect(mumRes.json<Array<{ title: string }>>()).toHaveLength(5);

    const kidShelf = await app.inject({ method: "GET", url: "/api/server-library", headers: asUser(kid.token) });
    expect(kidShelf.json<Array<{ title: string }>>().map((b) => b.title).sort()).toEqual([
      "Picture Start",
      "Unrated Wonder",
    ]);
  });

  it("child 10-13 additionally sees 7-rated; 16-rated stays hidden; blocklisted unrated stays hidden", async () => {
    const f = await createFixture();
    await prisma.blocklistGenre.create({ data: { genreId: f.horrorId } });

    const kid = await createAccount("kid-ten-thirteen", "child", "10-13");
    await shelfEverything(kid.id, [f.bookA, f.bookB, f.bookC, f.bookD, f.bookE]);

    const res = await app.inject({ method: "GET", url: "/api/audiobooks", headers: asUser(kid.token) });
    expect(res.json<Array<{ title: string }>>().map((b) => b.title).sort()).toEqual([
      "Middle Passage",
      "Picture Start",
      "Unrated Wonder",
    ]);
  });

  it("child 14-17 sees 16-rated but still not blocklisted", async () => {
    const f = await createFixture();
    await prisma.blocklistGenre.create({ data: { genreId: f.horrorId } });

    const kid = await createAccount("kid-fourteen-plus", "child", "14-17");
    await shelfEverything(kid.id, [f.bookA, f.bookB, f.bookC, f.bookD, f.bookE]);

    const res = await app.inject({ method: "GET", url: "/api/audiobooks", headers: asUser(kid.token) });
    expect(res.json<Array<{ title: string }>>().map((b) => b.title).sort()).toEqual([
      "Bitter Harvest",
      "Middle Passage",
      "Picture Start",
      "Unrated Wonder",
    ]);
  });

  it("hidden books are 404 on the single-book route, and the library add is 403 age_restricted; removal is allowed", async () => {
    const f = await createFixture();
    await prisma.blocklistGenre.create({ data: { genreId: f.horrorId } });

    const kid = await createAccount("kid-gates", "child", "under-6");
    await shelfEverything(kid.id, [f.bookA, f.bookC]);

    const hidden = await app.inject({ method: "GET", url: `/api/audiobooks/${f.bookC}`, headers: asUser(kid.token) });
    expect(hidden.statusCode).toBe(404);

    const add = await app.inject({
      method: "POST",
      url: `/api/audiobooks/${f.bookC}/library`,
      headers: asUser(kid.token),
    });
    expect(add.statusCode).toBe(403);
    expect(add.json<{ code: string }>().code).toBe("age_restricted");

    // Removing a (now hidden) book from the shelf is never age-gated.
    const remove = await app.inject({
      method: "DELETE",
      url: `/api/audiobooks/${f.bookC}/library`,
      headers: asUser(kid.token),
    });
    expect(remove.statusCode).toBe(200);
    expect(remove.json<{ removed: boolean }>().removed).toBe(true);
  });

  it("media tokens are refused for hidden books and issued for visible ones", async () => {
    const f = await createFixture();
    await prisma.blocklistGenre.create({ data: { genreId: f.horrorId } });

    const kid = await createAccount("kid-media", "child", "under-6");
    await shelfEverything(kid.id, [f.bookA, f.bookC]);

    const hidden = await app.inject({
      method: "POST",
      url: "/api/auth/media-token",
      headers: asUser(kid.token),
      payload: { kind: "book-stream", id: f.bookC },
    });
    expect(hidden.statusCode).toBe(404);

    const visible = await app.inject({
      method: "POST",
      url: "/api/auth/media-token",
      headers: asUser(kid.token),
      payload: { kind: "book-stream", id: f.bookA },
    });
    expect(visible.statusCode).toBe(200);
    expect(visible.json<{ token: string }>().token).toBeTruthy();
  });

  it("blocklist beats confirmed rating below the ceiling", async () => {
    const f = await createFixture();
    await prisma.blocklistGenre.create({ data: { genreId: f.horrorId } });
    // Give the blocklisted book a friendly confirmed rating — the blocklist must still hide it.
    await prisma.mediaItem.update({ where: { id: f.bookE }, data: { minimumAge: 0 } });

    const kid = await createAccount("kid-blocklist-beats", "child", "14-17");
    await shelfEverything(kid.id, [f.bookE]);

    const res = await app.inject({ method: "GET", url: "/api/audiobooks", headers: asUser(kid.token) });
    expect(res.json<Array<{ title: string }>>()).toHaveLength(0);
  });

  it("re-rating a book removes it for children on the next fetch", async () => {
    const f = await createFixture();
    const kid = await createAccount("kid-rerate", "child", "under-6");
    await shelfEverything(kid.id, [f.bookD]);

    const before = await app.inject({ method: "GET", url: "/api/audiobooks", headers: asUser(kid.token) });
    expect(before.json<Array<{ title: string }>>()).toHaveLength(1);

    await prisma.mediaItem.update({ where: { id: f.bookD }, data: { minimumAge: 9 } });
    const after = await app.inject({ method: "GET", url: "/api/audiobooks", headers: asUser(kid.token) });
    expect(after.json<Array<{ title: string }>>()).toHaveLength(0);
  });

  it("review queue refuses children with 403", async () => {
    const kid = await createAccount("kid-review-queue", "child", "under-6");
    const member = await createAccount("member-review-queue", "member", null);
    const res = await app.inject({ method: "GET", url: "/api/enrichment/review-queue", headers: asUser(kid.token) });
    expect(res.statusCode).toBe(403);
    // The admin-only route gate (spec 28) already refuses everyone but admins
    // on authenticated deployments; the in-route child check covers the
    // auth-disabled development case. Either way: not a 200.
    const ok = await app.inject({ method: "GET", url: "/api/enrichment/review-queue", headers: asUser(member.token) });
    expect(ok.statusCode).toBe(403);
  });

  it("genre counts exclude books the child cannot see", async () => {
    const f = await createFixture();
    await prisma.blocklistGenre.create({ data: { genreId: f.horrorId } });

    const kid = await createAccount("kid-counts", "child", "under-6");
    await shelfEverything(kid.id, [f.bookA, f.bookB, f.bookC, f.bookD, f.bookE]);

    const res = await app.inject({ method: "GET", url: "/api/genres", headers: asUser(kid.token) });
    expect(res.statusCode).toBe(200);
    const counts = new Map<string, number>();
    for (const root of res.json<Array<{ name: string; count: number }>>()) {
      counts.set(root.name, root.count);
    }
    // Children: bookA only (bookB rated 7). Horror: nothing (blocklisted).
    expect(counts.get("Children")).toBe(1);
    expect(counts.get("Horror")).toBe(0);
  });

  it("favourites list and id set exclude hidden books", async () => {
    const f = await createFixture();
    await prisma.blocklistGenre.create({ data: { genreId: f.horrorId } });

    const kid = await createAccount("kid-favs", "child", "under-6");
    await prisma.favourite.createMany({
      data: [f.bookA, f.bookB, f.bookD, f.bookE].map((mediaItemId) => ({ profileId: kid.id, mediaItemId })),
    });

    const list = await app.inject({ method: "GET", url: "/api/favourites", headers: asUser(kid.token) });
    expect(list.json<Array<{ book: { title: string } }>>().map((row) => row.book.title).sort()).toEqual([
      "Picture Start",
      "Unrated Wonder",
    ]);

    const ids = await app.inject({ method: "GET", url: "/api/favourites/ids", headers: asUser(kid.token) });
    expect(ids.json<number[]>().sort()).toEqual([f.bookA, f.bookD].sort());
  });

  it("history excludes hidden books (but the child's own rows remain)", async () => {
    const f = await createFixture();
    await prisma.blocklistGenre.create({ data: { genreId: f.horrorId } });

    const kid = await createAccount("kid-history", "child", "under-6");
    for (const mediaItemId of [f.bookA, f.bookB, f.bookD, f.bookE]) {
      await prisma.playSession.create({
        data: {
          profileId: kid.id,
          mediaItemId,
          startedAt: new Date(),
          endedAt: new Date(),
          fromPosition: 0,
          toPosition: 10,
        },
      });
    }

    const res = await app.inject({ method: "GET", url: "/api/history", headers: asUser(kid.token) });
    expect(res.statusCode).toBe(200);
    const ids = res.json<Array<{ mediaItemId: number }>>().map((row) => row.mediaItemId);
    expect(new Set(ids)).toEqual(new Set([f.bookA, f.bookD]));
  });

  it("a child with an unrecognised band gets the strictest view (fail closed)", async () => {
    const f = await createFixture();
    const kid = await createAccount("kid-invalid-band", "child", "adult");
    await shelfEverything(kid.id, [f.bookA, f.bookD]);

    const res = await app.inject({ method: "GET", url: "/api/audiobooks", headers: asUser(kid.token) });
    expect(res.json<Array<{ title: string }>>().map((b) => b.title).sort()).toEqual([
      "Picture Start",
      "Unrated Wonder",
    ]);
  });

  it("the child's own session payload carries role=child and the band; never another profile's", async () => {
    const kid = await createAccount("kid-session-payload", "child", "10-13");
    const res = await app.inject({ method: "GET", url: "/api/auth/session", headers: asUser(kid.token) });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ role: string; profile: { role: string; ageBand: string | null } }>()).toMatchObject({
      role: "child",
      profile: { role: "child", ageBand: "10-13" },
    });
  });

  it("an unauthenticated caller still gets 401 (pre-spec-38 behaviour preserved)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/audiobooks" });
    expect(res.statusCode).toBe(401);
  });
});
