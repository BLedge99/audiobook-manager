import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { AuthService, AuthFailure } from "./service";
import { hashPassword } from "./password";
import type { OAuthConfig } from "./oauth";
import { createTestDatabase } from "../test-support/database";
import { buildApp } from "../app";

const db = createTestDatabase("audiobook-handoff-test-");

let prisma: PrismaClient;
let app: Awaited<ReturnType<typeof buildApp>> | undefined;
let clock = new Date("2026-06-01T00:00:00.000Z");
const now = () => clock;
let auth: AuthService;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const oauthFixture: OAuthConfig = {
  enabled: true,
  providers: [
    {
      id: "google",
      clientId: "google-client-id",
      clientSecret: "google-client-secret",
      authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      userInfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
      scope: "openid profile email",
      issuer: "https://accounts.google.com",
    },
  ],
};

beforeAll(async () => {
  prisma = new PrismaClient();
  auth = new AuthService({ prisma, now, oauth: oauthFixture });
  app = await buildApp({
    logger: false,
    appPassword: "household",
    prisma,
    oauth: oauthFixture,
    // Same fixed clock as the service, or the routes' session checks judge
    // rows by real time while we mint them by fake time.
    now,
  });
}, 120_000);

afterAll(async () => {
  await app?.close();
  await prisma.$disconnect();
  db.cleanup();
});

beforeEach(async () => {
  await prisma.oAuthHandoff.deleteMany();
  await prisma.session.deleteMany();
  await prisma.profile.deleteMany();
  clock = new Date("2026-06-01T00:00:00.000Z");
});

/** The valid exchange body, in the exact shape the client will post. */
function handoffBody(code: string, state: string) {
  return { code, state };
}

async function makeProfile(name: string, disabled = false) {
  return prisma.profile.create({
    data: {
      name,
      disabled,
      passwordHash: await hashPassword("pw-" + name),
      passwordUpdatedAt: now(),
      lastActiveAt: now(),
    },
  });
}

describe("OAuthHandoff creation", () => {
  it("stores only sha256 hashes of the code and state, with a 60-second TTL", async () => {
    const profile = await makeProfile("creator");
    const state = "app-generated-state-0123456789abcdef";

    const { code } = await auth.createOAuthHandoff({ profileId: profile.id, state });

    const row = await prisma.oAuthHandoff.findFirst();
    expect(row).not.toBeNull();
    expect(row!.codeHash).toBe(sha256(code));
    expect(row!.stateHash).toBe(sha256(state));
    expect(row!.codeHash).not.toContain(code);
    expect(row!.stateHash).not.toContain(state);
    expect(row!.consumedAt).toBeNull();
    expect(row!.profileId).toBe(profile.id);
    expect(row!.expiresAt.getTime() - clock.getTime()).toBeLessThanOrEqual(60_000);
    expect(row!.expiresAt.getTime() - clock.getTime()).toBeGreaterThan(0);
  });

  it("creates a fresh, distinct code every call", async () => {
    const profile = await makeProfile("creator2");
    const state = "state-0123456789abcdef0123456789abcdef";
    const a = await auth.createOAuthHandoff({ profileId: profile.id, state });
    const b = await auth.createOAuthHandoff({ profileId: profile.id, state });
    expect(a.code).not.toBe(b.code);
  });
});

describe("OAuth handoff exchange", () => {
  it("exchanges once and mints a session that validates, then rejects a replay", async () => {
    const profile = await makeProfile("exchanger");
    const state = "state-0123456789abcdef0123456789abcdef01";
    const { code } = await auth.createOAuthHandoff({ profileId: profile.id, state });

    const result = await auth.consumeOAuthHandoff({
      ...handoffBody(code, state),
      meta: { userAgent: "handoff-test", deviceLabel: null },
      ip: "192.0.2.10",
    });

    expect(result.token).toBeTruthy();
    expect(result.profile?.id).toBe(profile.id);

    const context = await auth.validate(result.token);
    expect(context).not.toBeNull();
    expect(context?.profile?.id).toBe(profile.id);

    const sessionRow = await prisma.session.findFirst({ where: { profileId: profile.id } });
    expect(sessionRow?.via).toBe("oauth");

    await expect(
      auth.consumeOAuthHandoff({
        ...handoffBody(code, state),
        meta: { userAgent: "handoff-test", deviceLabel: null },
        ip: "192.0.2.10",
      }),
    ).rejects.toMatchObject({ status: 401, code: "oauth_handoff_invalid" });
  });

  it("rejects an unknown code with 401 oauth_handoff_invalid", async () => {
    await expect(
      auth.consumeOAuthHandoff({
        code: "does-not-exist",
        state: "whatever",
        meta: { userAgent: null, deviceLabel: null },
        ip: "192.0.2.11",
      }),
    ).rejects.toMatchObject({ status: 401, code: "oauth_handoff_invalid" });
  });

  it("rejects a state mismatch with 400 oauth_state_mismatch, leaving the handoff usable", async () => {
    const profile = await makeProfile("statecheck");
    const state = "state-a";
    const { code } = await auth.createOAuthHandoff({ profileId: profile.id, state });

    await expect(
      auth.consumeOAuthHandoff({
        code,
        state: "state-b",
        meta: { userAgent: null, deviceLabel: null },
        ip: "192.0.2.12",
      }),
    ).rejects.toMatchObject({ status: 400, code: "oauth_state_mismatch" });

    const row = await prisma.oAuthHandoff.findFirst({ where: { profileId: profile.id } });
    expect(row!.consumedAt).toBeNull();
  });

  it("rejects an expired handoff with 401 oauth_handoff_invalid", async () => {
    const profile = await makeProfile("expired");
    const state = "state-expiring";
    const { code } = await auth.createOAuthHandoff({ profileId: profile.id, state });
    clock = new Date(clock.getTime() + 61_000);

    await expect(
      auth.consumeOAuthHandoff({
        code,
        state,
        meta: { userAgent: null, deviceLabel: null },
        ip: "192.0.2.13",
      }),
    ).rejects.toMatchObject({ status: 401, code: "oauth_handoff_invalid" });
  });

  it("refuses the exchange for a disabled account", async () => {
    const profile = await makeProfile("disabled", true);
    const state = "state-disabled";
    const { code } = await auth.createOAuthHandoff({ profileId: profile.id, state });

    await expect(
      auth.consumeOAuthHandoff({
        code,
        state,
        meta: { userAgent: null, deviceLabel: null },
        ip: "192.0.2.14",
      }),
    ).rejects.toMatchObject({ status: 403, code: "account_disabled" });
  });

  it("rate-limits repeated failed exchanges per IP with oauth_rate_limited", async () => {
    const ip = "192.0.2.15";
    for (let attempt = 0; attempt < 10; attempt++) {
      await expect(
        auth.consumeOAuthHandoff({
          code: `bad-code-${attempt}`,
          state: "bad-state",
          meta: { userAgent: null, deviceLabel: null },
          ip,
        }),
      ).rejects.toMatchObject({ status: 401 });
    }
    await expect(
      auth.consumeOAuthHandoff({
        code: "bad-code-10",
        state: "bad-state",
        meta: { userAgent: null, deviceLabel: null },
        ip,
      }),
    ).rejects.toMatchObject({ status: 429, code: "oauth_rate_limited" });
  });
});

describe("OAuth handoff startup sweep", () => {
  it("cleanupExpired deletes expired handoffs and keeps fresh ones", async () => {
    const profile = await makeProfile("sweeper");
    const state = "state-sweep";
    await auth.createOAuthHandoff({ profileId: profile.id, state });
    clock = new Date(clock.getTime() + 61_000);
    await auth.cleanupExpired();
    expect(await prisma.oAuthHandoff.count()).toBe(0);
  });

  it("cleanupExpired keeps unexpired handoffs", async () => {
    const profile = await makeProfile("sweeper2");
    await auth.createOAuthHandoff({ profileId: profile.id, state: "state-fresh" });
    await auth.cleanupExpired();
    expect(await prisma.oAuthHandoff.count()).toBe(1);
  });
});

describe("POST /api/auth/oauth/handoff (route)", () => {
  it("is reachable without a session and rejects a malformed body with 400", async () => {
    const res = await app!.inject({
      method: "POST",
      url: "/api/auth/oauth/handoff",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an unknown code with 401 and a reviewed error code", async () => {
    const res = await app!.inject({
      method: "POST",
      url: "/api/auth/oauth/handoff",
      payload: { code: "unknown-code", state: "unknown-state" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("oauth_handoff_invalid");
  });

  it("exchanges a handoff for the password-login-shaped payload", async () => {
    const profile = await makeProfile("route-exchange");
    const state = "route-state-0123456789abcdef0123456789";
    const { code } = await auth.createOAuthHandoff({ profileId: profile.id, state });

    const res = await app!.inject({
      method: "POST",
      url: "/api/auth/oauth/handoff",
      payload: handoffBody(code, state),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.token).toBeTruthy();
    expect(body.profile?.id).toBe(profile.id);
    expect(body.role).toBeTruthy();
  });

  it("rejects a state mismatch with 400 and does not consume the handoff", async () => {
    const profile = await makeProfile("route-state");
    const state = "route-state-abcdef";
    const { code } = await auth.createOAuthHandoff({ profileId: profile.id, state });

    const res = await app!.inject({
      method: "POST",
      url: "/api/auth/oauth/handoff",
      payload: { code, state: "route-state-wrong" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("oauth_state_mismatch");

    const row = await prisma.oAuthHandoff.findFirst({ where: { profileId: profile.id } });
    expect(row!.consumedAt).toBeNull();
  });
});
