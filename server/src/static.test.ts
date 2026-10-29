import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "./app";
import { SESSION_HEADER } from "./auth/session";

/**
 * Spec 28, acceptance: "Static `/` and `/assets/*` load without a session;
 * `/api/audiobooks` still answers 401 without one."
 *
 * The production single-origin build is what regressed before: the auth gate
 * sat in front of the static handler, so the first request for `/` was a 401
 * and the login screen could not load. The dev server hides that because Vite
 * serves the assets, so the test supplies its own built `dist`.
 */
const dir = mkdtempSync(path.join(tmpdir(), "audiobook-static-test-"));
const dbFile = path.join(dir, "test.db");
const clientDist = path.join(dir, "dist");
mkdirSync(path.join(clientDist, "assets"), { recursive: true });
writeFileSync(path.join(clientDist, "index.html"), "<!doctype html><title>Bookle shell</title>");
writeFileSync(path.join(clientDist, "assets", "app.js"), "console.log('bookle');");

let app: Awaited<ReturnType<typeof buildApp>>;
let prisma: PrismaClient;

beforeAll(async () => {
  const isCI = process.env.CI === "true";
  if (!isCI) {
    process.env.DATABASE_URL = `file:${dbFile}`;
    const isPostgresUrl = (process.env.DATABASE_URL ?? "").startsWith("postgresql://") || (process.env.DATABASE_URL ?? "").startsWith("postgres://");
    process.env.CLIENT_DIST = clientDist;
    const schemaFlag = isPostgresUrl ? "" : `--schema "${path.join(__dirname, "..", "prisma", "schema.test.prisma")}"`;
    execSync(`npx prisma db push --accept-data-loss ${schemaFlag}`.trim(), {
      cwd: path.join(__dirname, ".."),
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL! },
      stdio: "ignore",
    });
  }
  prisma = new PrismaClient();
  app = await buildApp({ logger: false, appPassword: "household" });
}, 120_000);

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  delete process.env.CLIENT_DIST;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows can hold the SQLite handle briefly */
  }
});

describe("the production single-origin build", () => {
  it("serves the shell and its assets without a session", async () => {
    const shell = await app.inject({ method: "GET", url: "/" });
    expect(shell.statusCode).toBe(200);
    expect(shell.body).toContain("Bookle shell");

    const asset = await app.inject({ method: "GET", url: "/assets/app.js" });
    expect(asset.statusCode).toBe(200);
    expect(asset.body).toContain("bookle");
  });

  it("serves the shell for a deep link, so a reload does not 401", async () => {
    const deep = await app.inject({ method: "GET", url: "/library" });
    expect(deep.statusCode).toBe(200);
    expect(deep.body).toContain("Bookle shell");
  });

  it("keeps the API closed and keeps API misses as JSON", async () => {
    const closed = await app.inject({ method: "GET", url: "/api/audiobooks" });
    expect(closed.statusCode).toBe(401);
    expect(closed.json()).toEqual({ code: "auth_required" });

    // An unknown API path must not fall through to index.html.
    const session = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "household" },
    });
    const missing = await app.inject({
      method: "GET",
      url: "/api/nope",
      headers: { [SESSION_HEADER]: session.json<{ token: string }>().token },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ code: "not_found" });
  });
});
