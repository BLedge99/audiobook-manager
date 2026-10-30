import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../app";
import { hashPassword } from "./password";
import { createTestDatabase } from "../test-support/database";

/**
 * Spec 28: "Five consecutive failures in fifteen minutes lock the profile for
 * 30 seconds. Every further failure doubles the lock: 1 minute, 2, 4, 8, 15
 * maximum. A successful login clears the counter."
 *
 * Driven through the real route with a fake clock, so the retry-after the
 * client renders is the same number the service computed.
 */
const db = createTestDatabase("audiobook-lockout-test-");

const PASSWORD = "correct-horse-9";
const WRONG = "wrong-password-9";

let clock = new Date("2026-01-01T00:00:00.000Z");
const now = () => clock;

let app: Awaited<ReturnType<typeof buildApp>>;
let prisma: PrismaClient;
let profileId: number;

async function login(password: string) {
  return app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { profileId, password },
  });
}

/** One wrong password, returning the documented status and retry-after. */
async function fail() {
  const res = await login(WRONG);
  return {
    status: res.statusCode,
    code: res.json<{ code?: string }>().code,
    retryAfterSeconds: res.json<{ params?: { retryAfterSeconds?: number } }>().params
      ?.retryAfterSeconds,
  };
}

/**
 * Move to the expiry instant. Landing exactly on it must unlock: an expired
 * lock that still refuses would be a lock that never ends.
 */
function advance(seconds: number) {
  clock = new Date(clock.getTime() + seconds * 1000);
}

beforeAll(async () => {
  prisma = new PrismaClient();
  app = await buildApp({
    logger: false,
    appPassword: "household",
    mediaTokenSecret: "m".repeat(32),
    now,
    prisma,
  });
  const profile = await prisma.profile.create({
    data: {
      name: "lockout-person",
      passwordHash: await hashPassword(PASSWORD),
      passwordUpdatedAt: clock,
    },
  });
  profileId = profile.id;
}, 120_000);

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  db.cleanup();
});

describe("profile lockout backoff", () => {
  it("counts failures without locking, then locks for 30 seconds on the fifth", async () => {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      expect(await fail()).toMatchObject({ status: 401, code: "incorrect_password" });
    }

    expect(await fail()).toMatchObject({
      status: 429,
      code: "account_locked",
      retryAfterSeconds: 30,
    });

    // While locked, even the right password is refused and the wait is reported.
    const locked = await login(PASSWORD);
    expect(locked.statusCode).toBe(429);
    expect(locked.json()).toMatchObject({ code: "account_locked" });
  });

  it("doubles the lock on each further failure, capped at fifteen minutes", async () => {
    // Each round: wait out the current lock, fail once more, read the new lock.
    const expected = [60, 120, 240, 480, 900, 900];
    let current = 30;
    for (const seconds of expected) {
      advance(current);
      expect(await fail()).toMatchObject({
        status: 429,
        code: "account_locked",
        retryAfterSeconds: seconds,
      });
      current = seconds;
    }
  });

  it("clears the counter and the lock after a successful sign-in", async () => {
    advance(900);
    expect((await login(PASSWORD)).statusCode).toBe(200);

    const row = await prisma.profile.findUniqueOrThrow({ where: { id: profileId } });
    expect(row.failedLoginCount).toBe(0);
    expect(row.lockedUntil).toBeNull();

    // The next failure starts from the bottom of the ladder again.
    expect((await fail()).status).toBe(401);
  });
});
