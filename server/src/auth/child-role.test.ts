import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "./password";
import { createTestDatabase } from "../test-support/database";
import { buildApp, SESSION_HEADER } from "../app";

/**
 * A child profile IS a child everywhere: the login payload, the account
 * picker, device-credential sessions and the auth context must all carry
 * "child", or the client's parental UI silently fails open (server-side age
 * gates still hold — this is the belt to their braces).
 */
const db = createTestDatabase("audiobook-child-role-test-");
const PASSWORD = "child-password-9";

let app: Awaited<ReturnType<typeof buildApp>>;
let prisma: PrismaClient;
let child: { id: number };

beforeAll(async () => {
  prisma = new PrismaClient();
  child = await prisma.profile.create({
    data: {
      name: `child-${randomUUID().slice(0, 8)}`,
      role: "child",
      ageBand: "10-13",
      passwordHash: await hashPassword(PASSWORD),
      passwordUpdatedAt: new Date(),
    },
    select: { id: true },
  });
  app = await buildApp({ logger: false, appPassword: "household", mediaTokenSecret: "m".repeat(32), prisma });
}, 120_000);

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  db.cleanup();
});

describe("child role propagation", () => {
  it("login returns role child (not member)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { profileId: child.id, password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ role: string }>().role).toBe("child");
  });

  it("the account picker reports no role at all", async () => {
    // The picker renders nothing role-dependent; the field would only hand
    // an attacker a target map. Role comes from /api/auth/session instead.
    const res = await app.inject({ method: "GET", url: "/api/auth/accounts" });
    const row = res.json<{ id: number; role?: string }[]>().find((entry) => entry.id === child.id);
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty("role");
  });

  it("GET /api/auth/session still reports child via the session", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { profileId: child.id, password: PASSWORD },
    });
    const token = login.json<{ token: string }>().token;
    const session = await app.inject({ method: "GET", url: "/api/auth/session", headers: { [SESSION_HEADER]: token } });
    expect(session.statusCode).toBe(200);
    expect(session.json<{ role: string; profile: { role: string } }>().role).toBe("child");
  });
});
