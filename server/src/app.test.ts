import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildApp } from "./app";

const dir = mkdtempSync(path.join(tmpdir(), "audiobook-test-"));
const dbFile = path.join(dir, "test.db");
process.env.DATABASE_URL = `file:${dbFile}`;

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  execSync("npx prisma db push --skip-generate", {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: `file:${dbFile}` },
    stdio: "ignore",
  });
  app = await buildApp({ logger: false, appPassword: "household" });
}, 120_000);

afterAll(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("auth gate", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await app.inject({ method: "GET", url: "/api/audiobooks" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a wrong password", async () => {
    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "nope" } });
    expect(res.statusCode).toBe(401);
  });

  it("accepts the household password and issues a session cookie", async () => {
    const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "household" } });
    expect(res.statusCode).toBe(200);
    expect(res.cookies.find((c) => c.name === "house_session")).toBeTruthy();
  });

  it("allows authenticated access with the cookie", async () => {
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "household" } });
    const cookieHeader = login.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const res = await app.inject({ method: "GET", url: "/api/audiobooks", headers: { cookie: cookieHeader } });
    expect(res.statusCode).toBe(200);
  });

  it("logout invalidates the session", async () => {
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "household" } });
    const cookieHeader = login.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie: cookieHeader } });
    const res = await app.inject({ method: "GET", url: "/api/audiobooks", headers: { cookie: cookieHeader } });
    expect(res.statusCode).toBe(401);
  });
});

describe("profiles", () => {
  it("creates, lists, and deletes profiles", async () => {
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "household" } });
    const cookieHeader = login.cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    const created = await app.inject({ method: "POST", url: "/api/profiles", payload: { name: "Sam", color: "cyan" }, headers: { cookie: cookieHeader } });
    expect(created.statusCode).toBe(201);
    const profileId = created.json().id;

    const list = await app.inject({ method: "GET", url: "/api/profiles", headers: { cookie: cookieHeader } });
    expect(list.json().map((p: { name: string }) => p.name)).toContain("Sam");

    const del = await app.inject({ method: "DELETE", url: `/api/profiles/${profileId}`, headers: { cookie: cookieHeader } });
    expect(del.statusCode).toBe(204);
  });

  it("rejects empty profile names", async () => {
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "household" } });
    const cookieHeader = login.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const res = await app.inject({ method: "POST", url: "/api/profiles", payload: { name: "  " }, headers: { cookie: cookieHeader } });
    expect(res.statusCode).toBe(400);
  });
});
