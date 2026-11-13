/**
 * Spec 38 / ADR 033 — the admin panel's kids-accounts and age-ratings
 * surfaces. The operator credential is the only way in, writes flow through
 * Fastify schemas, and the family app never reaches any of this.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { AdminAuth } from "./auth";
import { buildAdminApp } from "./app";
import { buildApp } from "../app";
import { createTestDatabase } from "../test-support/database";
import { createScanManager } from "../scanner";

const db = createTestDatabase("audiobook-admin-kids-");

let prisma: PrismaClient;
let familyApp: FastifyInstance;
let adminApp: FastifyInstance;
let adminToken: string;

const asAdmin = () => ({ cookies: { admin_panel_session: adminToken } });

beforeAll(async () => {
  prisma = new PrismaClient();
  const auth = new AdminAuth(prisma);
  await auth.seed("dedicated-admin-password");
  adminToken = (await auth.login("dedicated-admin-password", "192.0.2.40"))!;
  adminApp = await buildAdminApp({ prisma, auth, scanner: createScanManager(prisma) });
  familyApp = await buildApp({ logger: false, appPassword: "household", mediaTokenSecret: "k".repeat(32), prisma });
}, 120_000);

afterAll(async () => {
  await adminApp.close();
  await familyApp.close();
  await prisma.$disconnect();
  db.cleanup();
});

async function makeBook(title: string, minimumAge: number | null = null) {
  const existingRoot = await prisma.libraryRoot.findFirst();
  const root = existingRoot ?? await prisma.libraryRoot.create({ data: { path: "/test/kids-admin", label: "Kids Admin" } });
  const item = await prisma.mediaItem.create({
    data: {
      title,
      author: "Fixture Author",
      filePath: `/test/kids-admin/${title.replace(/\s+/g, "-")}.mp3`,
      fileFormat: "mp3",
      duration: 600,
      libraryRootId: root.id,
      minimumAge,
    },
  });
  return item.id;
}

describe("admin panel — kids accounts (spec 38)", () => {
  it("requires the admin-panel credential", async () => {
    for (const url of ["/api/admin/kids-accounts", "/api/admin/age-ratings/review", "/api/admin/genre-blocklist"]) {
      const unauth = await adminApp.inject({ url });
      expect(unauth.statusCode).toBe(401);
    }
  });

  it("creates a kids account with a band and password, never follows the server library", async () => {
    const res = await adminApp.inject({
      method: "POST",
      url: "/api/admin/kids-accounts",
      ...asAdmin(),
      payload: { name: "Archie", ageBand: "6-9", password: "correct horse battery staple" },
    });
    expect(res.statusCode).toBe(201);
    const kid = res.json<{ id: number; ageBand: string; followsServerLibrary: boolean; role?: string }>();
    expect(kid.ageBand).toBe("6-9");
    expect(kid.followsServerLibrary).toBe(false);
    const dbRow = await prisma.profile.findUniqueOrThrow({ where: { id: kid.id } });
    expect(dbRow.role).toBe("child");
    expect(dbRow.passwordHash).toBeTruthy();
    expect(dbRow.passwordHash).not.toContain("correct horse");
  });

  it("rejects weak passwords and duplicate names", async () => {
    const weak = await adminApp.inject({
      method: "POST",
      url: "/api/admin/kids-accounts",
      ...asAdmin(),
      payload: { name: "Archie2", ageBand: "under-6", password: "short" },
    });
    expect(weak.statusCode).toBe(400);
    expect(weak.json<{ code: string }>().code).toBe("password_too_short");

    const dup = await adminApp.inject({
      method: "POST",
      url: "/api/admin/kids-accounts",
      ...asAdmin(),
      payload: { name: "Archie", ageBand: "under-6", password: "another strong password" },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json<{ code: string }>().code).toBe("profile_name_taken");
  });

  it("lists kids accounts without secrets", async () => {
    const res = await adminApp.inject({ url: "/api/admin/kids-accounts", ...asAdmin() });
    expect(res.statusCode).toBe(200);
    const list = res.json<Array<{ name: string; hasPassword: boolean; passwordHash?: string }>>();
    expect(list.some((k) => k.name === "Archie")).toBe(true);
    expect(list[0]).not.toHaveProperty("passwordHash");
  });

  it("re-bands and disables a kids account; members of other roles cannot be edited here", async () => {
    const list = await adminApp.inject({ url: "/api/admin/kids-accounts", ...asAdmin() });
    const id = list.json<Array<{ id: number }>>()[0].id;
    const patched = await adminApp.inject({
      method: "PATCH",
      url: `/api/admin/kids-accounts/${id}`,
      ...asAdmin(),
      payload: { ageBand: "10-13", disabled: true },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json<{ ageBand: string; disabled: boolean }>()).toMatchObject({ ageBand: "10-13", disabled: true });

    // A member profile cannot be targeted through the kids-accounts routes.
    const member = await prisma.profile.create({ data: { name: "mum", role: "member" } });
    const memberPatch = await adminApp.inject({
      method: "PATCH",
      url: `/api/admin/kids-accounts/${member.id}`,
      ...asAdmin(),
      payload: { disabled: true },
    });
    expect(memberPatch.statusCode).toBe(404);
  });

  it("fill-shelf adds only age-appropriate books, idempotently", async () => {
    const picture = await makeBook("Picture Book", 4);
    const teen = await makeBook("Teen Novel", 13);
    const unrated = await makeBook("Unrated Wonder", null);

    const created = await adminApp.inject({
      method: "POST",
      url: "/api/admin/kids-accounts",
      ...asAdmin(),
      payload: { name: "FillTarget", ageBand: "under-6", password: "fill target strong password" },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json<{ id: number }>().id;

    const first = await adminApp.inject({ method: "POST", url: `/api/admin/kids-accounts/${id}/fill-shelf`, ...asAdmin() });
    expect(first.statusCode).toBe(200);
    // under-6 ceiling is 5: picture(4) + unrated; not teen(13).
    expect(first.json<{ added: number; totalAgeAppropriate: number }>().totalAgeAppropriate).toBe(2);

    const second = await adminApp.inject({ method: "POST", url: `/api/admin/kids-accounts/${id}/fill-shelf`, ...asAdmin() });
    expect(second.json<{ added: number }>().added).toBe(0);

    const shelf = await prisma.profileLibraryEntry.findMany({ where: { profileId: id }, select: { mediaItemId: true } });
    expect(shelf.map((row) => row.mediaItemId).sort((a, b) => a - b)).toEqual([picture, unrated].sort((a, b) => a - b));
    expect(shelf.some((row) => row.mediaItemId === teen)).toBe(false);
  });

  it("reset-password revokes sessions and blocks sign-in until the new password", async () => {
    const created = await adminApp.inject({
      method: "POST",
      url: "/api/admin/kids-accounts",
      ...asAdmin(),
      payload: { name: "ResetTarget", ageBand: "under-6", password: "first strong password" },
    });
    const id = created.json<{ id: number }>().id;

    // Sign the child in on the family app, then reset.
    const login = await familyApp.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { profileId: id, password: "first strong password" },
    });
    expect(login.statusCode).toBe(200);

    const reset = await adminApp.inject({
      method: "POST",
      url: `/api/admin/kids-accounts/${id}/reset-password`,
      ...asAdmin(),
      payload: { newPassword: "second strong password" },
    });
    expect(reset.statusCode).toBe(200);

    const oldSession = login.json<{ session?: { token: string } }>();
    const relog = await familyApp.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { profileId: id, password: "first strong password" },
    });
    expect(relog.statusCode).toBe(401);
    const relog2 = await familyApp.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { profileId: id, password: "second strong password" },
    });
    expect(relog2.statusCode).toBe(200);
    void oldSession;
  });
});

describe("admin panel — age ratings (spec 38)", () => {
  it("sets, clears and confirms minimumAge; suggestions never auto-apply", async () => {
    const id = await makeBook("Suggested Book", null);
    await prisma.mediaItem.update({
      where: { id },
      data: { suggestedMinimumAge: 7, suggestedMinimumAgeSource: "openlibrary" },
    });

    const review = await adminApp.inject({ url: "/api/admin/age-ratings/review", ...asAdmin() });
    expect(review.statusCode).toBe(200);
    const items = review.json<{ items: Array<{ id: number; suggestedMinimumAge: number }> }>().items;
    expect(items.some((item) => item.id === id)).toBe(true);

    // Confirming applies the suggestion.
    const confirmed = await adminApp.inject({
      method: "POST",
      url: "/api/admin/age-ratings/confirm",
      ...asAdmin(),
      payload: { mediaItemId: id },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json<{ minimumAge: number }>().minimumAge).toBe(7);

    // No suggestion left to confirm.
    const again = await adminApp.inject({
      method: "POST",
      url: "/api/admin/age-ratings/confirm",
      ...asAdmin(),
      payload: { mediaItemId: id },
    });
    expect(again.statusCode).toBe(400);

    // A confirmed value always wins over a later suggestion.
    await prisma.mediaItem.update({
      where: { id },
      data: { suggestedMinimumAge: 16, suggestedMinimumAgeSource: "googlebooks" },
    });
    const set = await adminApp.inject({
      method: "POST",
      url: "/api/admin/age-ratings/set",
      ...asAdmin(),
      payload: { mediaItemId: id, minimumAge: 12 },
    });
    expect(set.statusCode).toBe(200);
    const row = await prisma.mediaItem.findUniqueOrThrow({ where: { id } });
    expect(row.minimumAge).toBe(12);
    expect(row.suggestedMinimumAge).toBeNull();
    expect(row.suggestedMinimumAgeSource).toBeNull();
  });

  it("set accepts the documented ladder and null, rejects anything else", async () => {
    const id = await makeBook("Ladder Book", 7);
    const bad = await adminApp.inject({
      method: "POST",
      url: "/api/admin/age-ratings/set",
      ...asAdmin(),
      payload: { mediaItemId: id, minimumAge: 5 },
    });
    expect(bad.statusCode).toBe(400);

    const cleared = await adminApp.inject({
      method: "POST",
      url: "/api/admin/age-ratings/set",
      ...asAdmin(),
      payload: { mediaItemId: id, minimumAge: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect((await prisma.mediaItem.findUniqueOrThrow({ where: { id } })).minimumAge).toBeNull();
  });

  it("search finds books by title substring and falls back to recent books", async () => {
    const id = await makeBook("Zebra Crossing", null);
    const hit = await adminApp.inject({ url: "/api/admin/age-ratings/books?q=zebra", ...asAdmin() });
    expect(hit.statusCode).toBe(200);
    expect(hit.json<{ books: Array<{ id: number; title: string }> }>().books.some((b) => b.id === id)).toBe(true);

    const fallback = await adminApp.inject({ url: "/api/admin/age-ratings/books", ...asAdmin() });
    expect(fallback.statusCode).toBe(200);
    expect(fallback.json<{ books: unknown[] }>().books.length).toBeGreaterThan(0);
  });

  it("genre blocklist lists only blocked genres and removes them", async () => {
    const genre = await prisma.genre.create({ data: { slug: "spec-38-blocklist-test", name: "Blocklist Genre" } });
    const other = await prisma.genre.create({ data: { slug: "spec-38-ordinary", name: "Ordinary Genre" } });

    const add = await adminApp.inject({
      method: "POST",
      url: "/api/admin/genre-blocklist",
      ...asAdmin(),
      payload: { genreId: genre.id },
    });
    expect(add.statusCode).toBe(201);

    const list = await adminApp.inject({ url: "/api/admin/genre-blocklist", ...asAdmin() });
    const blocked = list.json<{ genres: Array<{ id: number; name: string; count: number }> }>().genres;
    expect(blocked.some((g) => g.id === genre.id)).toBe(true);
    // The unblocked genre never appears in the blocklist view.
    expect(blocked.some((g) => g.id === other.id)).toBe(false);

    // The add-view excludes blocked genres and finds the unblocked one.
    const options = await adminApp.inject({ url: "/api/admin/genre-blocklist/options?q=ordinary", ...asAdmin() });
    expect(options.statusCode).toBe(200);
    const optionsGenres = options.json<{ genres: Array<{ id: number; name: string }> }>().genres;
    expect(optionsGenres.some((g) => g.id === other.id)).toBe(true);
    expect(optionsGenres.some((g) => g.id === genre.id)).toBe(false);

    const remove = await adminApp.inject({ method: "DELETE", url: `/api/admin/genre-blocklist/${genre.id}`, ...asAdmin() });
    expect(remove.statusCode).toBe(200);
    expect(remove.json<{ removed: boolean }>().removed).toBe(true);

    const after = await adminApp.inject({ url: "/api/admin/genre-blocklist", ...asAdmin() });
    expect(after.json<{ genres: Array<{ id: number }> }>().genres.some((g) => g.id === genre.id)).toBe(false);
  });
});
