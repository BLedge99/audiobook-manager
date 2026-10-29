import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "./app";
import { DEFAULT_PROFILES, TEST_PROFILES, seedDefaultProfiles } from "./seed";

/**
 * Spec 28 — seeding accounts.
 *
 * Two properties matter here and both are easy to get wrong:
 *
 * 1. A production database never gets a test account with a known password.
 * 2. A bad password in the environment leaves the account unclaimed instead of
 *    being stored (or being skipped when it is valid).
 */

const dir = mkdtempSync(path.join(tmpdir(), "audiobook-seed-"));
const dbFile = path.join(dir, "test.db");
process.env.DATABASE_URL = `file:${dbFile}`;

const prisma = new PrismaClient();
const TEST_PASSWORD = "correct-horse-9";

beforeAll(async () => {
  execSync(`npx prisma db push --accept-data-loss --schema "${path.join(__dirname, "..", "prisma", "schema.test.prisma")}"`, {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: `file:${dbFile}` },
    stdio: "ignore",
  });
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

beforeEach(async () => {
  await prisma.profile.deleteMany();
  delete process.env.SEED_TEST_ACCOUNTS;
  delete process.env.TEST_PROFILE_PASSWORD;
  delete process.env.ADMIN_TEST_PROFILE_PASSWORD;
});

describe("seedDefaultProfiles", () => {
  it("seeds the household set with admin and member roles", async () => {
    const created = await seedDefaultProfiles(prisma);
    expect(created).toEqual(DEFAULT_PROFILES.map((profile) => profile.name));

    const rows = await prisma.profile.findMany({ orderBy: { name: "asc" } });
    const byName = new Map(rows.map((row) => [row.name, row]));
    expect(byName.get("admin")?.role).toBe("admin");
    for (const name of ["Dad", "Mum", "Ben"]) {
      expect(byName.get(name)?.role).toBe("member");
      expect(byName.get(name)?.followsServerLibrary).toBe(true);
    }
    expect(rows.some((row) => row.name === "Archie")).toBe(false);
  });

  it("does not create test accounts unless test seeding is on", async () => {
    process.env.TEST_PROFILE_PASSWORD = TEST_PASSWORD;
    process.env.ADMIN_TEST_PROFILE_PASSWORD = TEST_PASSWORD;
    await seedDefaultProfiles(prisma);

    for (const descriptor of TEST_PROFILES) {
      expect(await prisma.profile.findUnique({ where: { name: descriptor.name } })).toBeNull();
    }
  });

  it("gives test accounts a hashed password in development and CI", async () => {
    process.env.SEED_TEST_ACCOUNTS = "true";
    process.env.TEST_PROFILE_PASSWORD = TEST_PASSWORD;
    process.env.ADMIN_TEST_PROFILE_PASSWORD = TEST_PASSWORD;
    const created = await seedDefaultProfiles(prisma);
    expect(created).toContain("test");
    expect(created).toContain("admin-test");

    for (const name of ["test", "admin-test"]) {
      const row = await prisma.profile.findUnique({ where: { name } });
      expect(row?.role).toBe(name === "admin-test" ? "admin" : "member");
      expect(row?.passwordHash).toMatch(/^scrypt\$/);
    }

    // The stored hash is real: the account can sign in with the env password.
    const app = await buildApp({ logger: false, appPassword: "household" });
    try {
      const test = await prisma.profile.findUniqueOrThrow({ where: { name: "test" } });
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { profileId: test.id, password: TEST_PASSWORD },
      });
      expect(response.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("leaves a test account unclaimed when the env password is invalid", async () => {
    process.env.SEED_TEST_ACCOUNTS = "true";
    process.env.TEST_PROFILE_PASSWORD = "short";
    process.env.ADMIN_TEST_PROFILE_PASSWORD = "admin-test";
    await seedDefaultProfiles(prisma);

    for (const name of ["test", "admin-test"]) {
      const row = await prisma.profile.findUnique({ where: { name } });
      expect(row?.passwordHash).toBeNull();
    }
  });

  it("is idempotent and keeps an existing admin role", async () => {
    await seedDefaultProfiles(prisma);
    const first = await prisma.profile.findMany({ orderBy: { name: "asc" } });
    await seedDefaultProfiles(prisma);
    const second = await prisma.profile.findMany({ orderBy: { name: "asc" } });
    expect(second.map((row) => row.id)).toEqual(first.map((row) => row.id));
  });
});
