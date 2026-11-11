import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../app";
import { createTestDatabase } from "../test-support/database";
import { DEMO_POLICY_TABLE, demoHiddenRoutes } from "./demo-policy";

const db = createTestDatabase("audiobook-demo-policy-test-");

let app: Awaited<ReturnType<typeof buildApp>>;
let prisma: PrismaClient;
let cookie: string;

beforeAll(async () => {
  prisma = new PrismaClient();
  app = await buildApp({ logger: false, appPassword: "household", prisma, accountExperience: "demo" });
  const signup = await app.inject({
    method: "POST",
    url: "/api/auth/signup",
    payload: { email: `demo-policy-${Date.now()}@example.test`, password: "long-enough-demo-pass-9" },
  });
  expect(signup.statusCode).toBe(200);
  cookie = signup.cookies.map((entry) => `${entry.name}=${entry.value}`).join("; ");
}, 120_000);

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  db.cleanup();
});

describe("the demo-hidden set (spec 37 step 7.6)", () => {
  it("answers 404 for every hidden route, with a session", async () => {
    for (const entry of demoHiddenRoutes()) {
      const response = await app.inject({
        method: entry.method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
        url: entry.example,
        headers: { cookie },
        ...(entry.payload ? { payload: entry.payload } : {}),
      });
      expect(response.statusCode, `${entry.method} ${entry.example} (${entry.label})`).toBe(404);
    }
  });

  it("answers 404 even for the publicly-reachable hidden entries, without a session", async () => {
    const publicHidden = DEMO_POLICY_TABLE.filter((entry) => entry.publicApi && entry.hiddenInDemo);
    expect(publicHidden.length).toBeGreaterThan(0);
    for (const entry of publicHidden) {
      const response = await app.inject({
        method: entry.method as "GET" | "POST",
        url: entry.example,
        ...(entry.payload ? { payload: entry.payload } : {}),
      });
      expect(response.statusCode, `${entry.method} ${entry.example} (${entry.label})`).toBe(404);
    }
  });

  it("lets public paths through without a session", async () => {
    for (const path of ["/api/health", "/api/config", "/api/auth/providers"]) {
      const response = await app.inject({ method: "GET", url: path });
      expect(response.statusCode, path).toBe(200);
    }
  });

  it("keeps the formerly-401 routes at 404 for scope-less sessions", async () => {
    // A household break-glass session has no account scope; every demo route
    // hidden for scope-less sessions must answer 404, not 401.
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { password: "household" },
    });
    expect(login.statusCode).toBe(200);
    const householdCookie = login.cookies.map((entry) => `${entry.name}=${entry.value}`).join("; ");

    const tags = await app.inject({
      method: "GET",
      url: "/api/audiobooks/1/tags",
      headers: { cookie: householdCookie },
    });
    expect(tags.statusCode).toBe(404);

    const similar = await app.inject({
      method: "GET",
      url: "/api/discover/similar/1",
      headers: { cookie: householdCookie },
    });
    expect(similar.statusCode).toBe(404);
  });

  it("keeps the table self-consistent", () => {
    for (const entry of DEMO_POLICY_TABLE) {
      expect(entry.path.test(entry.example), `${entry.label}: example matches its own pattern`).toBe(true);
    }
  });
});
