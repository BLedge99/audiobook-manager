import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { AuthService } from "./service";
import { createTestDatabase } from "../test-support/database";
import type { OAuthProvider } from "./oauth";

/**
 * Spec 43 phase 2.2: OAuth auto-provisioning (a brand-new Google/GitHub
 * identity becoming a member of the library) is a demo-mode feature. A
 * household deployment is claim/invite-only; an unknown verified identity is
 * rejected, never provisioned.
 */

const db = createTestDatabase("audiobook-oauth-gate-");

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = new PrismaClient();
});

afterAll(async () => {
  await prisma.$disconnect();
  db.cleanup();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ALLOW_OAUTH_AUTO_PROVISION;
});

const GOOGLE: OAuthProvider = {
  id: "google",
  clientId: "google-client-id",
  clientSecret: "google-client-secret",
  authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  userInfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
  scope: "openid profile email",
  issuer: "https://accounts.google.com",
};

function stubFetch(identity: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === GOOGLE.tokenUrl) {
        return new Response(JSON.stringify({ access_token: "provider-token" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === GOOGLE.userInfoUrl) {
        return new Response(JSON.stringify(identity), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

const META = { userAgent: "vitest" };

function signIn(service: AuthService) {
  return service.signInWithOAuth({
    provider: GOOGLE,
    code: "provider-code",
    state: "state-value",
    stateCookieValue: "state-value",
    codeVerifier: "verifier",
    redirectUri: "https://books.example/api/auth/google/callback",
    meta: META,
    ip: "192.0.2.1",
  });
}

function householdService() {
  return new AuthService({
    prisma,
    oauth: { enabled: true, providers: [GOOGLE] },
    accountExperience: "household",
    now: () => new Date("2026-11-16T12:00:00.000Z"),
  });
}

function demoService() {
  return new AuthService({
    prisma,
    oauth: { enabled: true, providers: [GOOGLE] },
    accountExperience: "demo",
    now: () => new Date("2026-11-16T12:00:00.000Z"),
  });
}

let seq = 0;
function identity(sub: string) {
  seq += 1;
  return { sub, email: `ada-${seq}@example.com`, email_verified: true, name: `Ada ${seq}` };
}

describe("OAuth auto-provisioning (spec 43 phase 2.2)", () => {
  it("rejects an unknown verified identity on a household deployment", async () => {
    const id = identity("gate-household-1");
    stubFetch(id);
    const before = await prisma.profile.count();
    await expect(signIn(householdService())).rejects.toMatchObject({
      code: "oauth_signup_disabled",
      status: 403,
    });
    expect(await prisma.profile.count()).toBe(before);
  });

  it("provisions a member profile on a demo deployment", async () => {
    const id = identity("gate-demo-1");
    stubFetch(id);
    const result = await signIn(demoService());
    expect(result.profile?.role).toBe("member");
    const created = await prisma.profile.findFirst({ where: { oauthProvider: "google", oauthProviderId: id.sub } });
    expect(created).not.toBeNull();
    expect(created?.followsServerLibrary).toBe(true);
  });

  it("provisions on a household deployment only with the explicit opt-in", async () => {
    const id = identity("gate-optin-1");
    process.env.ALLOW_OAUTH_AUTO_PROVISION = "true";
    stubFetch(id);
    const result = await signIn(householdService());
    expect(result.profile?.role).toBe("member");
  });

  it("does not consult the gate for a known provider identity", async () => {
    const id = identity("gate-known-1");
    await prisma.profile.create({
      data: { name: `Known ${id.sub}`, role: "member", oauthProvider: "google", oauthProviderId: id.sub },
    });
    stubFetch(id);
    const result = await signIn(householdService());
    expect(result.profile?.name).toBe(`Known ${id.sub}`);
  });

  it("still refuses to silently link a known email across providers/credentials", async () => {
    const id = identity("gate-email-1");
    await prisma.profile.create({ data: { name: `Email ${id.sub}`, role: "member", email: id.email as string } });
    stubFetch(id);
    await expect(signIn(householdService())).rejects.toMatchObject({
      code: "account_linking_required",
      status: 409,
    });
  });

  it("reuses the auto-created profile on the next demo sign-in", async () => {
    const id = identity("gate-demo-2");
    stubFetch(id);
    await signIn(demoService());
    const before = await prisma.profile.count();
    await signIn(demoService());
    expect(await prisma.profile.count()).toBe(before);
  });
});
