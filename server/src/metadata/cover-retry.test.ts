import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { recordCoverOutcome } from "./cover-retry";
import { createTestDatabase } from "../test-support/database";

/**
 * Spec 43 phase 7.3: the cover-retry counter that stops provider re-fetches
 * for books whose providers simply never carry art.
 */

const db = createTestDatabase("audiobook-cover-retry-");

let prisma: PrismaClient;
let libraryRootId = 0;

beforeAll(async () => {
  prisma = new PrismaClient();
  const root = await prisma.libraryRoot.create({ data: { path: "/lib", label: "Test" } });
  libraryRootId = root.id;
});

afterAll(async () => {
  await prisma.$disconnect();
  db.cleanup();
});

let seq = 0;
async function makeBook(coverImagePath: string | null) {
  seq += 1;
  return prisma.mediaItem.create({
    data: {
      libraryRootId,
      title: `Cover Retry ${seq}`,
      author: "Author",
      filePath: `/lib/cover-retry-${seq}.mp3`,
      fileFormat: "mp3",
      coverImagePath,
      enrichmentStatus: "applied",
    },
  });
}

describe("recordCoverOutcome (spec 43 phase 7.3)", () => {
  it("increments the counter on every coverless pass", async () => {
    const book = await makeBook(null);
    expect(book.coverRetryCount).toBe(0);
    await recordCoverOutcome(prisma, book.id);
    await recordCoverOutcome(prisma, book.id);
    await recordCoverOutcome(prisma, book.id);
    const after = await prisma.mediaItem.findUniqueOrThrow({ where: { id: book.id } });
    expect(after.coverRetryCount).toBe(3);
  });

  it("resets the counter when a pass ends with a cover", async () => {
    const book = await makeBook(null);
    await recordCoverOutcome(prisma, book.id);
    await recordCoverOutcome(prisma, book.id);
    expect((await prisma.mediaItem.findUniqueOrThrow({ where: { id: book.id } })).coverRetryCount).toBe(2);

    await prisma.mediaItem.update({
      where: { id: book.id },
      data: { coverImagePath: "/found.jpg" },
    });
    await recordCoverOutcome(prisma, book.id);
    expect((await prisma.mediaItem.findUniqueOrThrow({ where: { id: book.id } })).coverRetryCount).toBe(0);
  });

  it("keeps counting past the default cap (the queue is what stops, not the counter)", async () => {
    const book = await makeBook(null);
    for (let i = 0; i < 5; i += 1) await recordCoverOutcome(prisma, book.id);
    expect((await prisma.mediaItem.findUniqueOrThrow({ where: { id: book.id } })).coverRetryCount).toBe(5);
  });

  it("does nothing for a book that no longer exists", async () => {
    await expect(recordCoverOutcome(prisma, 999_999)).resolves.toBeUndefined();
  });
});
