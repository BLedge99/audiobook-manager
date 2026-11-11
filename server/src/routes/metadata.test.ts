import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../app";
import type { LLMAdapter } from "../ai/llm";
import { createTestDatabase } from "../test-support/database";

const db = createTestDatabase("audiobook-metadata-test-");

/** A controllable adapter so the route can be tested without LM Studio. */
const llm: LLMAdapter = {
  available: vi.fn(async () => true),
  chat: vi.fn(async () => "1"),
};

let prisma: PrismaClient;
let app: Awaited<ReturnType<typeof buildApp>>;
let bookId: number;

beforeAll(async () => {
  prisma = new PrismaClient();
  const root = await prisma.libraryRoot.create({ data: { path: "/metadata-test-root", label: "test" } });
  const book = await prisma.mediaItem.create({
    data: {
      title: "The Right Book",
      author: "Some Author",
      filePath: "/metadata-test-root/secret-file.mp3",
      fileFormat: "mp3",
      libraryRootId: root.id,
    },
  });
  bookId = book.id;
  await prisma.metadataCandidate.createMany({
    data: [
      { mediaItemId: bookId, source: "librivox", providerKey: "k1", title: "Candidate One", author: "A One", confidence: 0.9 },
      { mediaItemId: bookId, source: "librivox", providerKey: "k2", title: "Candidate Two", author: "A Two", confidence: 0.8 },
    ],
  });
  app = await buildApp({ logger: false, prisma, llm });
}, 120_000);

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  db.cleanup();
});

beforeEach(() => {
  vi.mocked(llm.available).mockReset().mockResolvedValue(true);
  vi.mocked(llm.chat).mockReset().mockResolvedValue("2");
});

describe("POST /api/audiobooks/:id/ai-suggest", () => {
  it("asks the adapter and returns the chosen candidate", async () => {
    const response = await app.inject({ method: "POST", url: `/api/audiobooks/${bookId}/ai-suggest` });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { available: boolean; suggestion: { title: string } | null };
    expect(body.available).toBe(true);
    expect(body.suggestion?.title).toBe("Candidate Two");
    expect(llm.chat).toHaveBeenCalledTimes(1);
  });

  it("does not call the model when the adapter is unavailable", async () => {
    vi.mocked(llm.available).mockResolvedValue(false);
    const response = await app.inject({ method: "POST", url: `/api/audiobooks/${bookId}/ai-suggest` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ available: false, suggestion: null });
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it("returns available with no suggestion when there are no candidates", async () => {
    const root = await prisma.libraryRoot.findFirstOrThrow();
    const empty = await prisma.mediaItem.create({
      data: { title: "No Candidates", author: "Nobody", filePath: "/metadata-test-root/empty.mp3", fileFormat: "mp3", libraryRootId: root.id },
    });
    vi.mocked(llm.chat).mockClear();
    const response = await app.inject({ method: "POST", url: `/api/audiobooks/${empty.id}/ai-suggest` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ available: true, suggestion: null });
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it("asks the model without the server's filesystem path", async () => {
    const prompts: string[] = [];
    vi.mocked(llm.chat).mockImplementation(async (messages) => {
      prompts.push(messages.map((message) => message.content).join("\n"));
      return "2";
    });
    const response = await app.inject({ method: "POST", url: `/api/audiobooks/${bookId}/ai-suggest` });
    expect(response.statusCode).toBe(200);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("The Right Book");
    expect(prompts[0]).toContain("Candidate Two");
    expect(prompts[0]).not.toContain("/metadata-test-root");
    expect(prompts[0]).not.toContain("secret-file.mp3");
  });
});
