/**
 * Spec 38 — provider-derived age suggestions at apply time.
 *
 * The suggestion is written only when the book has no confirmed rating; a
 * confirmed rating always wins and is never touched by enrichment.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createTestDatabase } from "../test-support/database";
import { applyCandidate } from "./apply";

const db = createTestDatabase("audiobook-apply-suggestion-");

let prisma: PrismaClient;
let rootId: number;

const baseItem = (title: string, minimumAge: number | null = null) =>
  prisma.mediaItem.create({
    data: {
      title,
      author: "Some Author",
      filePath: `/test/suggestion/${title.replace(/\s+/g, "-")}.mp3`,
      fileFormat: "mp3",
      duration: 600,
      libraryRootId: rootId,
      minimumAge,
    },
  });

beforeAll(async () => {
  prisma = new PrismaClient();
  const root = await prisma.libraryRoot.create({ data: { path: "/test/suggestion", label: "Suggestion Fixture" } });
  rootId = root.id;
});

afterAll(async () => {
  await prisma.$disconnect();
  db.cleanup();
});

describe("applyCandidate + age suggestions (spec 38)", () => {
  it("writes the Google Books MATURE suggestion for an unrated book", async () => {
    const item = await baseItem("Mature Hour");
    await applyCandidate(prisma, item, {
      source: "googlebooks",
      title: "Mature Hour",
      confidence: 0.99,
      maturityRating: "MATURE",
    });
    const row = await prisma.mediaItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(row.suggestedMinimumAge).toBe(16);
    expect(row.suggestedMinimumAgeSource).toBe("googlebooks");
    expect(row.minimumAge).toBeNull();
  });

  it("writes the Open Library subject suggestion for an unrated book", async () => {
    const item = await baseItem("Juvenile Affair");
    await applyCandidate(prisma, item, {
      source: "openlibrary",
      title: "Juvenile Affair",
      confidence: 0.99,
      genres: ["Mystery"],
      subjectStrings: ["Mystery -- Juvenile fiction"],
    });
    const row = await prisma.mediaItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(row.suggestedMinimumAge).toBe(12);
    expect(row.suggestedMinimumAgeSource).toBe("openlibrary");
  });

  it("never writes a suggestion over a confirmed rating", async () => {
    const item = await baseItem("Confirmed Favourite", 7);
    await applyCandidate(prisma, item, {
      source: "googlebooks",
      title: "Confirmed Favourite",
      confidence: 0.99,
      maturityRating: "MATURE",
      subjectStrings: ["Adventure -- Juvenile fiction"],
    });
    const row = await prisma.mediaItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(row.minimumAge).toBe(7);
    expect(row.suggestedMinimumAge).toBeNull();
    expect(row.suggestedMinimumAgeSource).toBeNull();
  });

  it("writes nothing when the providers offer no signal", async () => {
    const item = await baseItem("Nothing Suggested");
    await applyCandidate(prisma, item, {
      source: "librivox",
      title: "Nothing Suggested",
      confidence: 0.99,
      genres: ["History"],
    });
    const row = await prisma.mediaItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(row.suggestedMinimumAge).toBeNull();
  });
});
