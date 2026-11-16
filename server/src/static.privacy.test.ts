import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "./app";
import { createTestDatabase } from "./test-support/database";
import { PrismaClient } from "@prisma/client";

/**
 * Regression: GET /privacy used to answer 200 with an empty body whenever the
 * client accepted gzip/br/deflate, because the handler sent the html with
 * `reply.send()` but did not `return` it — see the inline fix comment in
 * routes/static.ts. The notice is a GDPR Art. 12–14 document; a blank page
 * breaks it entirely.
 */
const db = createTestDatabase("audiobook-privacy-test-");
let app: Awaited<ReturnType<typeof buildApp>>;
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

describe("GET /privacy (public privacy notice)", () => {
  it("returns the notice document, not an empty body", async () => {
    const response = await app.inject({ method: "GET", url: "/privacy" });
    expect(response.statusCode).toBe(200);
    expect(String(response.headers["content-type"])).toContain("text/html");
    expect(response.body.length).toBeGreaterThan(1000);
    expect(response.body).toContain("Privacy notice");
  });

  it("returns the same document when the client accepts a compressed encoding", async () => {
    for (const encoding of ["gzip", "br", "deflate", "identity"]) {
      const response = await app.inject({
        method: "GET",
        url: "/privacy",
        headers: { "accept-encoding": encoding },
      });
      expect(response.statusCode, `encoding=${encoding}`).toBe(200);
      const body = response.rawPayload?.length ?? response.body.length;
      expect(body, `encoding=${encoding}`).toBeGreaterThan(1000);
    }
  });
});
