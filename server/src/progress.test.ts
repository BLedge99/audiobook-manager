import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildApp } from "./app";

const dir = mkdtempSync(path.join(tmpdir(), "audiobook-progress-"));
const dbFile = path.join(dir, "test.db");
process.env.DATABASE_URL = `file:${dbFile}`;

let app: Awaited<ReturnType<typeof buildApp>>;
let cookie: string;
let profileId: number;
let bookId: number;

beforeAll(async () => {
  execSync("npx prisma db push --skip-generate", {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: `file:${dbFile}` },
    stdio: "ignore",
  });
  app = await buildApp({ logger: false, appPassword: "household" });
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "household" } });
  cookie = login.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const profile = await app.inject({ method: "POST", url: "/api/profiles", payload: { name: "Sam" }, headers: { cookie } });
  profileId = profile.json().id;

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const root = await prisma.libraryRoot.create({ data: { path: "/tmp/lib" } });
  const book = await prisma.mediaItem.create({
    data: { title: "Test Book", author: "Author", filePath: "/tmp/lib/book.m4b", fileFormat: "m4b", duration: 1000, libraryRootId: root.id },
  });
  bookId = book.id;
}, 120_000);

afterAll(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const profileHeaders = () => ({ cookie, "x-profile-id": String(profileId) });

describe("progress", () => {
  it("requires a profile header", async () => {
    const res = await app.inject({ method: "PUT", url: `/api/audiobooks/${bookId}/progress`, payload: { position: 5 }, headers: { cookie } });
    expect(res.statusCode).toBe(400);
  });

  it("saves and retrieves resume position", async () => {
    await app.inject({ method: "PUT", url: `/api/audiobooks/${bookId}/progress`, payload: { position: 123 }, headers: profileHeaders() });
    const res = await app.inject({ method: "GET", url: `/api/audiobooks/${bookId}/progress`, headers: profileHeaders() });
    expect(res.json()).toMatchObject({ position: 123, completed: false });
  });

  it("clamps negative and overlong positions", async () => {
    const neg = await app.inject({ method: "PUT", url: `/api/audiobooks/${bookId}/progress`, payload: { position: -50 }, headers: profileHeaders() });
    expect(neg.json().position).toBe(0);
    const over = await app.inject({ method: "PUT", url: `/api/audiobooks/${bookId}/progress`, payload: { position: 99999 }, headers: profileHeaders() });
    expect(over.json().position).toBe(1000);
    expect(over.json().completed).toBe(true);
  });

  it("marks completed near the end by default", async () => {
    const res = await app.inject({ method: "PUT", url: `/api/audiobooks/${bookId}/progress`, payload: { position: 960 }, headers: profileHeaders() });
    expect(res.json().completed).toBe(true);
  });

  it("keeps profiles isolated", async () => {
    const other = await app.inject({ method: "POST", url: "/api/profiles", payload: { name: "Alex" }, headers: { cookie } });
    const otherId = other.json().id;
    const res = await app.inject({ method: "GET", url: `/api/audiobooks/${bookId}/progress`, headers: { cookie, "x-profile-id": String(otherId) } });
    expect(res.json()).toMatchObject({ position: 0, completed: false });
  });
});

describe("sessions", () => {
  it("records a listening session", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/audiobooks/${bookId}/sessions`,
      payload: { fromPosition: 100, toPosition: 400, speed: 1.5 },
      headers: profileHeaders(),
    });
    expect(res.statusCode).toBe(201);
    const history = await app.inject({ method: "GET", url: "/api/history", headers: profileHeaders() });
    expect(history.json()).toHaveLength(1);
    expect(history.json()[0]).toMatchObject({ fromPosition: 100, toPosition: 400, speed: 1.5 });
  });

  it("rejects sessions missing positions", async () => {
    const res = await app.inject({ method: "POST", url: `/api/audiobooks/${bookId}/sessions`, payload: {}, headers: profileHeaders() });
    expect(res.statusCode).toBe(400);
  });
});
