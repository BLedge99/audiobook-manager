import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../app";
import { createTestDatabase } from "../test-support/database";

const db = createTestDatabase("audiobook-enrichment-test-");

let app: Awaited<ReturnType<typeof buildApp>>;
let prisma: PrismaClient;
let bookId: number;
let reviewBookId: number;

beforeAll(async () => {
  prisma = new PrismaClient();
  const root = await prisma.libraryRoot.create({ data: { path: "/enrichment-test-root", label: "test" } });
  const book = await prisma.mediaItem.create({
    data: {
      title: "Overridden Title",
      author: "Some Author",
      filePath: "/enrichment-test-root/book.mp3",
      fileFormat: "mp3",
      libraryRootId: root.id,
    },
  });
  bookId = book.id;
  // A human owns the title; enrichment must not rewrite it.
  await prisma.fieldOverride.create({
    data: { mediaItemId: bookId, field: "title", value: "Overridden Title" },
  });
  const reviewBook = await prisma.mediaItem.create({
    data: {
      title: "Needs Review",
      author: "Some Author",
      filePath: "/enrichment-test-root/review.mp3",
      fileFormat: "mp3",
      libraryRootId: root.id,
      enrichmentStatus: "review",
    },
  });
  reviewBookId = reviewBook.id;
  app = await buildApp({ logger: false, prisma });
}, 120_000);

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  db.cleanup();
});

describe("enrichment endpoints", () => {
  it("reports status with counters", async () => {
    const response = await app.inject({ method: "GET", url: "/api/enrichment/status" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, unknown>;
    expect(typeof body.status).toBe("string");
    expect(body).toHaveProperty("queued");
    expect(body).toHaveProperty("processed");
  });

  it("enqueues an unknown book id as an empty run", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/enrichment/run",
      payload: { mediaItemId: 999_999 },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { queued: number; message: string | null };
    expect(body.queued).toBe(0);
    expect(body.message).toBe("Nothing to enrich");
  });

  it("lists the review queue without filesystem paths", async () => {
    const response = await app.inject({ method: "GET", url: "/api/enrichment/review-queue" });
    expect(response.statusCode).toBe(200);
    const items = response.json() as Array<Record<string, unknown>>;
    const entry = items.find((item) => item.id === reviewBookId);
    expect(entry).toBeDefined();
    expect(entry).not.toHaveProperty("filePath");
    expect(entry).not.toHaveProperty("coverImagePath");
  });

  it("routes a manual lookup through the run machinery and honours a field override", async () => {
    // Offline provider stub: only LibriVox answers, with an exact title match.
    const originalFetch = global.fetch;
    global.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("librivox.org")) {
        return new Response(JSON.stringify({
          books: [{
            id: "4242",
            title: "Overridden Title",
            authors: [{ first_name: "Some", last_name: "Author" }],
            description: "A description from LibriVox.",
            copyright_year: 2005,
            language: "english",
          }],
        }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    try {
      const response = await app.inject({ method: "POST", url: `/api/audiobooks/${bookId}/enrich` });
      expect(response.statusCode).toBe(200);
      const body = response.json() as Array<Record<string, unknown>>;
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThanOrEqual(1);
      expect(body[0]).not.toHaveProperty("raw");
      expect(body[0]).not.toHaveProperty("providerKey");

      const book = await prisma.mediaItem.findUnique({ where: { id: bookId } });
      // The user's override wins; enrichment may fill the rest.
      expect(book?.title).toBe("Overridden Title");
      expect(book?.enrichmentStatus).toBe("applied");
      expect(book?.enrichedAt).not.toBeNull();

      // A run row was written, like any other enrichment pass.
      const run = await prisma.enrichmentRun.findFirst({ orderBy: { id: "desc" } });
      expect(run?.status).toBe("complete");
      expect(run?.queued).toBe(1);
      expect(run?.processed).toBe(1);
      expect(run?.applied).toBe(1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("404s manual enrich for an unknown book", async () => {
    const response = await app.inject({ method: "POST", url: "/api/audiobooks/999999/enrich" });
    expect(response.statusCode).toBe(404);
  });
});
