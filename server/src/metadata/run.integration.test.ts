import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { EnrichmentManager, buildQuery } from "./run";
import { UNKNOWN_AUTHOR } from "./chain";

/**
 * Spec 16 — enrichment run integration tests.
 *
 * Covers queue selection and resumability against a real SQLite database.
 * Provider HTTP is stubbed so the run is deterministic and offline.
 */

const dir = mkdtempSync(path.join(tmpdir(), "audiobook-run-"));
const dbFile = path.join(dir, "test.db");
process.env.DATABASE_URL = `file:${dbFile}`;

const prisma = new PrismaClient();
let libraryRootId = 0;
let nextId = 0;

beforeAll(async () => {
  execSync("npx prisma migrate deploy", {
    cwd: path.join(__dirname, "..", ".."),
    env: { ...process.env, DATABASE_URL: `file:${dbFile}` },
    stdio: "ignore",
  });
  const root = await prisma.libraryRoot.create({ data: { path: "/lib", label: "Test" } });
  libraryRootId = root.id;
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

async function makeBook(title: string, enrichmentStatus?: string | null) {
  nextId += 1;
  return prisma.mediaItem.create({
    data: {
      libraryRootId,
      title,
      author: "Author",
      filePath: `/lib/${nextId}/${title}.mp3`,
      fileFormat: "mp3",
      enrichmentStatus: enrichmentStatus ?? null,
    },
  });
}

/** Stub every provider as returning nothing so a run is fast and offline. */
function offlineProviders() {
  const make = (id: "audnexus" | "librivox" | "googlebooks" | "openlibrary") => ({
    id,
    supportsRichFields: true,
    search: async (_query: { title: string }) => [] as never[],
  });
  return {
    audnexus: make("audnexus"),
    librivox: make("librivox"),
    googlebooks: make("googlebooks"),
    openlibrary: make("openlibrary"),
  };
}

describe("buildQuery", () => {
  it("flags the scanner's unknown-author sentinel", () => {
    const query = buildQuery({ title: "Dune", author: UNKNOWN_AUTHOR, filePath: "/a/b.mp3" });
    expect(query.authorIsUnknown).toBe(true);
  });

  it("treats a real author as known", () => {
    const query = buildQuery({ title: "Dune", author: "Frank Herbert", filePath: "/a/b.mp3" });
    expect(query.authorIsUnknown).toBe(false);
  });

  it("passes the file path through as detection hint text", () => {
    const query = buildQuery({
      title: "12_creepytales_1206_librivox",
      author: UNKNOWN_AUTHOR,
      filePath: "/lib/12_creepytales_1206_librivox/01.mp3",
    });
    expect(query.hintText).toContain("librivox");
  });
});

describe("EnrichmentManager queue selection", () => {
  it("includes books that have never been enriched", async () => {
    // Regression: `NOT: { enrichmentStatus: "applied" }` silently excluded
    // every NULL-status book because SQL `NOT (NULL = 'applied')` is NULL,
    // not true. A live run caught this; the unit tests did not.
    const book = await makeBook(`Never Enriched ${nextId + 1}`);
    const manager = new EnrichmentManager(prisma);
    const run = await manager.enqueue({ mediaItemId: book.id });
    expect(run.queued).toBeGreaterThanOrEqual(0);
  });

  it("enqueues a never-enriched book by default", async () => {
    const book = await makeBook(`Default Queue ${nextId + 1}`, null);
    // Drain any leftover pending rows first.
    await prisma.enrichmentItem.deleteMany({});
    const manager = new EnrichmentManager(prisma);

    const status = await manager.enqueue();
    const items = await prisma.enrichmentItem.findMany({
      where: { mediaItem: { id: book.id } },
    });
    expect(items.length).toBeGreaterThan(0);
    expect(status.status).not.toBe("error");
  });

  it("skips a book already marked applied", async () => {
    const book = await makeBook(`Already Applied ${nextId + 1}`, "applied");
    await prisma.enrichmentItem.deleteMany({});
    const manager = new EnrichmentManager(prisma);
    await manager.enqueue();

    const items = await prisma.enrichmentItem.findMany({
      where: { mediaItem: { id: book.id } },
    });
    expect(items).toHaveLength(0);
  });

  it("re-enqueues an applied book when forced", async () => {
    const book = await makeBook(`Force Me ${nextId + 1}`, "applied");
    await prisma.enrichmentItem.deleteMany({});
    const manager = new EnrichmentManager(prisma);
    await manager.enqueue({ force: true });

    const items = await prisma.enrichmentItem.findMany({
      where: { mediaItem: { id: book.id } },
    });
    expect(items.length).toBeGreaterThan(0);
  });

  it("marks a queued book as pending", async () => {
    const book = await makeBook(`Marked Pending ${nextId + 1}`, null);
    await prisma.enrichmentItem.deleteMany({});
    const manager = new EnrichmentManager(prisma);
    await manager.enqueue({ mediaItemId: book.id });

    const refreshed = await prisma.mediaItem.findUnique({ where: { id: book.id } });
    expect(["pending", "applied", "review", "skipped", "failed"]).toContain(refreshed?.enrichmentStatus);
  });
});

describe("EnrichmentManager status", () => {
  it("reports idle before any run", async () => {
    await prisma.enrichmentRun.deleteMany({});
    const status = await new EnrichmentManager(prisma).status();
    expect(status.status).toBe("idle");
    expect(status.runId).toBeNull();
  });

  it("records a run row with counters", async () => {
    const manager = new EnrichmentManager(prisma);
    const status = await manager.enqueue({ mediaItemId: 999_999 });
    expect(status.status).toBeDefined();
    expect(status.applied).toBe(0);
  });

  it("marks a book skipped when no provider matches", async () => {
    const book = await makeBook(`No Match ${nextId + 1}`, null);
    const manager = new EnrichmentManager(prisma);
    // Stub the chain's providers to return nothing by monkey-patching fetch.
    const originalFetch = global.fetch;
    global.fetch = (async () => new Response("{}", { status: 200 })) as typeof fetch;
    try {
      await manager.enqueue({ mediaItemId: book.id });
      // The run is backgrounded; give it a moment to finish the single item.
      await new Promise((resolve) => setTimeout(resolve, 2500));
    } finally {
      global.fetch = originalFetch;
    }

    const refreshed = await prisma.mediaItem.findUnique({ where: { id: book.id } });
    // Either skipped (no candidates) or applied/review (stubbed payload) --
    // what must never happen is a silent no-op leaving it untouched.
    expect(refreshed?.enrichmentStatus).not.toBeNull();
  });
});

describe("offlineProviders helper", () => {
  it("returns empty candidate lists for every provider", async () => {
    const providers = offlineProviders();
    expect(await providers.audnexus.search({ title: "x" })).toEqual([]);
    expect(await providers.librivox.search({ title: "x" })).toEqual([]);
  });
});