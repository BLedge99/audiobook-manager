import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app";
import { buildAdminApp } from "./admin/app";
import { AdminAuth } from "./admin/auth";
import { createTestDatabase } from "./test-support/database";
import { createScanManager } from "./scanner";

/**
 * The app serves every byte the browser executes (SPA shell, admin panel,
 * media). It must send the security headers itself — relying on the edge
 * proxy (Caddy) means the direct-Node and Render paths ship without them.
 */
const db = createTestDatabase("audiobook-headers-test-");
const clientDist = path.join(db.dir, "dist");
const adminDist = path.join(db.dir, "admin-dist");
mkdirSync(path.join(clientDist, "assets"), { recursive: true });
mkdirSync(path.join(adminDist, "assets"), { recursive: true });
writeFileSync(path.join(clientDist, "index.html"), "<!doctype html><title>Bookle shell</title>");
writeFileSync(path.join(adminDist, "index.html"), "<!doctype html><title>Admin shell</title>");

let app: FastifyInstance;
let adminApp: FastifyInstance;
let prisma: PrismaClient;

function expectSecurityHeaders(response: { headers: Record<string, unknown> }) {
  expect(response.headers["x-content-type-options"]).toBe("nosniff");
  expect(String(response.headers["content-security-policy"])).toContain("default-src 'self'");
  expect(String(response.headers["content-security-policy"])).toContain("frame-ancestors 'none'");
  expect(String(response.headers["content-security-policy"])).toContain("object-src 'none'");
  // Provider cover CDNs must stay reachable from the browser (Discover fetches them).
  for (const host of [
    "https://covers.openlibrary.org",
    "https://archive.org",
    "https://cdn.audnex.us",
    "https://books.google.com",
    "https://books.googleusercontent.com",
  ]) {
    expect(String(response.headers["content-security-policy"])).toContain(host);
  }
  expect(response.headers["referrer-policy"]).toBeTruthy();
}

beforeAll(async () => {
  process.env.CLIENT_DIST = clientDist;
  process.env.ADMIN_CLIENT_DIST = adminDist;
  prisma = new PrismaClient();
  app = await buildApp({ logger: false, appPassword: "household", prisma });
  adminApp = await buildAdminApp({
    prisma,
    auth: new AdminAuth(prisma),
    scanner: createScanManager(prisma),
    logger: false,
  });
}, 120_000);

afterAll(async () => {
  await app.close();
  await adminApp.close();
  await prisma.$disconnect();
  delete process.env.CLIENT_DIST;
  delete process.env.ADMIN_CLIENT_DIST;
  db.cleanup();
});

describe("security headers (family listener)", () => {
  it("sends CSP, nosniff, frame-ancestors and referrer-policy on the shell", async () => {
    const response = await app.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(200);
    expectSecurityHeaders(response);
  });

  it("sends them on API responses too", async () => {
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expectSecurityHeaders(response);
  });
});

describe("security headers (admin listener)", () => {
  it("sends the same policy on admin responses", async () => {
    const response = await adminApp.inject({ method: "GET", url: "/api/health" });
    expectSecurityHeaders(response);
  });
});
