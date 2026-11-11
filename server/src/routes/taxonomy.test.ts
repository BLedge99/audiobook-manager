import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../app";
import { createTestDatabase } from "../test-support/database";

const db = createTestDatabase("audiobook-taxonomy-test-");

let app: Awaited<ReturnType<typeof buildApp>>;
let prisma: PrismaClient;

beforeAll(async () => {
  prisma = new PrismaClient();
  app = await buildApp({ logger: false, prisma });
}, 120_000);

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  db.cleanup();
});

describe("genres", () => {
  it("lists, creates, updates and deletes a genre", async () => {
    const listed = await app.inject({ method: "GET", url: "/api/genres" });
    expect(listed.statusCode).toBe(200);
    expect(Array.isArray(listed.json())).toBe(true);

    const created = await app.inject({
      method: "POST",
      url: "/api/genres",
      payload: { slug: "mystery", name: "Mystery" },
    });
    expect(created.statusCode).toBe(200);
    const genre = created.json() as { id: number; slug: string; name: string };

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/genres/${genre.id}`,
      payload: { name: "Mystery & Crime" },
    });
    expect(updated.statusCode).toBe(200);
    expect((updated.json() as { name: string }).name).toBe("Mystery & Crime");

    const deleted = await app.inject({ method: "DELETE", url: `/api/genres/${genre.id}` });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ deleted: true });
  });
});

describe("tags", () => {
  it("lists, creates, renames and deletes a tag", async () => {
    const listed = await app.inject({ method: "GET", url: "/api/tags" });
    expect(listed.statusCode).toBe(200);
    expect(Array.isArray(listed.json())).toBe(true);

    const created = await app.inject({
      method: "POST",
      url: "/api/tags",
      payload: { name: "Road Trip" },
    });
    expect([200, 201]).toContain(created.statusCode);
    const tag = created.json() as { id: number; name: string };

    const renamed = await app.inject({
      method: "PATCH",
      url: `/api/tags/${tag.id}`,
      payload: { name: "Road Trips" },
    });
    expect(renamed.statusCode).toBe(200);
    expect((renamed.json() as { name: string }).name).toBe("Road Trips");

    const deleted = await app.inject({ method: "DELETE", url: `/api/tags/${tag.id}` });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ deleted: true });
  });

  it("merges a tag into another", async () => {
    const a = await app.inject({ method: "POST", url: "/api/tags", payload: { name: "Merge A" } });
    const b = await app.inject({ method: "POST", url: "/api/tags", payload: { name: "Merge B" } });
    const tagA = a.json() as { id: number };
    const tagB = b.json() as { id: number };

    const merged = await app.inject({
      method: "POST",
      url: `/api/tags/${tagA.id}/merge`,
      payload: { targetTagId: tagB.id },
    });
    expect(merged.statusCode).toBe(200);
    expect(merged.json()).toEqual({ moved: 0, mergedInto: tagB.id });

    const gone = await prisma.tag.findUnique({ where: { id: tagA.id } });
    expect(gone).toBeNull();
  });
});
