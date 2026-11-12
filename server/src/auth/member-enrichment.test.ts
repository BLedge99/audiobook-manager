import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import path from "node:path";
import { PrismaClient, type Profile } from "@prisma/client";
import { buildApp, SESSION_HEADER } from "../app";
import { hashPassword } from "./password";
import { createTestDatabase } from "../test-support/database";

/**
 * Spec 28 / ADR 032 — members may look up and apply metadata for a book that
 * is not yet enrichment-applied; everything else stays admin-only.
 */

const db = createTestDatabase("audiobook-member-enrich-test-");
const dir = db.dir;

let app: Awaited<ReturnType<typeof buildApp>>;
let prisma: PrismaClient;
let seq = 0;

const PASSWORD = "member-password-9";

async function createProfile(role: "admin" | "member" = "member"): Promise<Profile> {
  seq += 1;
  return prisma.profile.create({
    data: {
      name: `member-enrich-${Date.now().toString(36)}-${seq}`,
      role,
      passwordHash: await hashPassword(PASSWORD),
      passwordUpdatedAt: new Date(),
    },
  });
}

async function login(profile: Profile) {
  return app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { profileId: profile.id, password: PASSWORD },
  });
}

async function tokenOf(
  response: Awaited<ReturnType<typeof login>>,
): Promise<string> {
  return response.json<{ token: string }>().token;
}

async function makeBook(
  ownerProfileIds: number[],
  enrichmentStatus: string | null,
): Promise<number> {
  seq += 1;
  const root = await prisma.libraryRoot.create({
    data: { path: path.join(dir, `root-${Date.now().toString(36)}-${seq}`), label: "t" },
  });
  const book = await prisma.mediaItem.create({
    data: {
      title: `Book ${seq}`,
      author: "Some Author",
      filePath: `book-${seq}.mp3`,
      fileFormat: "mp3",
      libraryRootId: root.id,
      enrichmentStatus,
    },
  });
  for (const profileId of ownerProfileIds) {
    await prisma.profileLibraryEntry.create({
      data: { profileId, mediaItemId: book.id },
    });
  }
  return book.id;
}

function stubProviders(): () => void {
  const originalFetch = global.fetch;
  global.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("librivox.org")) {
      return new Response(JSON.stringify({
        books: [{ id: "4242", title: "Book", authors: [{ first_name: "Some", last_name: "Author" }] }],
      }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  return () => { global.fetch = originalFetch; };
}

beforeAll(async () => {
  prisma = new PrismaClient();
  app = await buildApp({
    logger: false,
    prisma,
    appPassword: "household",
    mediaTokenSecret: "m".repeat(32),
  });
}, 120_000);

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  db.cleanup();
});

describe("spec 28 / ADR 032 — member eligibility", () => {
  it("lets a member enrich an unenriched book", async () => {
    const member = await createProfile("member");
    const bookId = await makeBook([member.id], "pending");
    const restore = stubProviders();
    try {
      const res = await app.inject({
        method: "POST",
        url: `/api/audiobooks/${bookId}/enrich`,
        headers: { [SESSION_HEADER]: await tokenOf(await login(member)) },
      });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json())).toBe(true);
    } finally {
      restore();
    }
  });

  it("refuses a member enrich once the book is enrichment-applied", async () => {
    const member = await createProfile("member");
    const bookId = await makeBook([member.id], "applied");
    const res = await app.inject({
      method: "POST",
      url: `/api/audiobooks/${bookId}/enrich`,
      headers: { [SESSION_HEADER]: await tokenOf(await login(member)) },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ code: "forbidden" });
  });

  it("keeps applied-book enrich available to an admin", async () => {
    const admin = await createProfile("admin");
    const bookId = await makeBook([admin.id], "applied");
    const restore = stubProviders();
    try {
      const res = await app.inject({
        method: "POST",
        url: `/api/audiobooks/${bookId}/enrich`,
        headers: { [SESSION_HEADER]: await tokenOf(await login(admin)) },
      });
      expect(res.statusCode).toBe(200);
    } finally {
      restore();
    }
  });

  it("refuses a member fetching candidates once the book is applied", async () => {
    const member = await createProfile("member");
    const bookId = await makeBook([member.id], "applied");
    const res = await app.inject({
      method: "GET",
      url: `/api/audiobooks/${bookId}/candidates`,
      headers: { [SESSION_HEADER]: await tokenOf(await login(member)) },
    });
    expect(res.statusCode).toBe(403);
  });

  it("refuses a member manual metadata edit but allows candidate apply on unenriched books", async () => {
    const member = await createProfile("member");
    const bookId = await makeBook([member.id], "pending");
    const token = await tokenOf(await login(member));

    const manual = await app.inject({
      method: "POST",
      url: `/api/audiobooks/${bookId}/metadata`,
      headers: { [SESSION_HEADER]: token },
      payload: { title: "Member changed this" },
    });
    expect(manual.statusCode).toBe(403);

    const candidate = await prisma.metadataCandidate.create({
      data: {
        mediaItemId: bookId,
        source: "librivox",
        title: "Lookup Title",
        providerKey: "member-apply-1",
        confidence: 0.95,
        raw: JSON.stringify({ id: "member-apply-1" }),
      },
    });
    const applied = await app.inject({
      method: "POST",
      url: `/api/audiobooks/${bookId}/metadata`,
      headers: { [SESSION_HEADER]: token },
      payload: { candidateId: candidate.id },
    });
    expect(applied.statusCode).toBe(200);
    const book = await prisma.mediaItem.findUnique({ where: { id: bookId } });
    expect(book?.enrichmentStatus).toBe("applied");
  });

  it("refuses member candidate apply once the book is applied", async () => {
    const member = await createProfile("member");
    const bookId = await makeBook([member.id], "applied");
    const candidate = await prisma.metadataCandidate.create({
      data: {
        mediaItemId: bookId,
        source: "librivox",
        title: "Ignored",
        providerKey: "member-apply-2",
        confidence: 0.9,
        raw: JSON.stringify({ id: "member-apply-2" }),
      },
    });
    const token = await tokenOf(await login(member));
    const res = await app.inject({
      method: "POST",
      url: `/api/audiobooks/${bookId}/metadata`,
      headers: { [SESSION_HEADER]: token },
      payload: { candidateId: candidate.id },
    });
    expect(res.statusCode).toBe(403);
  });
});
