/**
 * Spec 39 / ADR 034 — contract tests for GET /api/buy-context.
 *
 * The route's whole promise: never leaks, never 5xx, never logs the query,
 * never lets a retry storm through, and stays out of the database entirely.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../app";
import { createTestDatabase } from "../test-support/database";
import { clearBuyContextCache } from "../metadata/buy-context";
import { clearBuyContextRateCounters } from "./buy-context";

const db = createTestDatabase("audiobook-buy-context-");

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

beforeEach(() => {
  clearBuyContextCache();
  clearBuyContextRateCounters();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const WILDE_PAGE = {
  books: [
    {
      id: "365",
      title: "Picture of Dorian Gray",
      authors: [{ first_name: "Oscar", last_name: "Wilde" }],
      url_librivox: "https://librivox.org/picture-of-dorian-gray-version-3/",
    },
  ],
};

async function householdCookie() {
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { password: "household" } });
  return login.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

function stubFetch(body: unknown, status = 200) {
  const spy = vi.fn(async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("GET /api/buy-context", () => {
  it("answers 401 without any session, and 400 with a household cookie but no profile", async () => {
    const anonymous = await app.inject({
      method: "GET",
      url: "/api/buy-context?title=Dorian%20Gray",
    });
    expect(anonymous.statusCode).toBe(401);

    const noProfile = await app.inject({
      method: "GET",
      url: "/api/buy-context?title=Dorian%20Gray",
      headers: { cookie: await householdCookie() },
    });
    expect(noProfile.statusCode).toBe(400);
    expect(noProfile.json().code).toBe("profile_required");
  });

  it("returns the LibriVox match for an authenticated profile", async () => {
    stubFetch(WILDE_PAGE);
    const res = await app.inject({
      method: "GET",
      url: "/api/buy-context?title=The%20Picture%20of%20Dorian%20Gray&author=Oscar%20Wilde",
      headers: { cookie: await householdCookie(), "x-profile-id": "1" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      librivox: {
        id: "365",
        title: "Picture of Dorian Gray",
        url: "https://librivox.org/picture-of-dorian-gray-version-3/",
      },
    });
  });

  it("never surfaces an upstream 500 as a 5xx", async () => {
    stubFetch("nope", 500);
    const res = await app.inject({
      method: "GET",
      url: "/api/buy-context?title=Dorian%20Gray&author=Oscar%20Wilde",
      headers: { cookie: await householdCookie(), "x-profile-id": "1" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ librivox: null });
  });

  it("rejects a missing title with 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/buy-context?author=Wilde",
      headers: { cookie: await householdCookie(), "x-profile-id": "1" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("ignores unknown query parameters (Fastify's removeAdditional, same as every route)", async () => {
    stubFetch(WILDE_PAGE);
    const res = await app.inject({
      method: "GET",
      url: "/api/buy-context?title=X&price=1",
      headers: { cookie: await householdCookie(), "x-profile-id": "1" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("serves a second identical call from cache — LibriVox sees one request", async () => {
    const spy = stubFetch(WILDE_PAGE);
    const headers = { cookie: await householdCookie(), "x-profile-id": "1" };
    await app.inject({ method: "GET", url: "/api/buy-context?title=Dorian%20Gray&author=Wilde", headers });
    await app.inject({ method: "GET", url: "/api/buy-context?title=Dorian%20Gray&author=Wilde", headers });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("rate limits past 30 calls per minute per profile", async () => {
    stubFetch(WILDE_PAGE);
    const headers = { cookie: await householdCookie(), "x-profile-id": "1" };
    let last = 0;
    for (let i = 0; i < 31; i += 1) {
      const res = await app.inject({
        method: "GET",
        url: `/api/buy-context?title=Book%20${i}&author=Wilde`,
        headers,
      });
      last = res.statusCode;
    }
    expect(last).toBe(429);
    expect(((await app.inject({ method: "GET", url: "/api/buy-context?title=Z&author=Wilde", headers })).json()).code).toBe("rate_limited");
  });
});
