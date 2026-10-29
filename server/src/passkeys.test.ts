import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient, type Profile } from "@prisma/client";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { buildApp, SESSION_HEADER } from "./app";
import { hashPassword } from "./auth/password";
import {
  challengeFromClientData,
  defaultCredentialLabel,
  isCounterRegression,
  passkeyConfigFromEnv,
  type PasskeyConfig,
} from "./auth/passkeys";

const dir = mkdtempSync(path.join(tmpdir(), "audiobook-passkey-test-"));
const dbFile = path.join(dir, "test.db");

const CONFIG: PasskeyConfig = {
  rpId: "books.home.arpa",
  rpName: "Bookle",
  origins: ["https://books.home.arpa"],
};

const PASSWORD = "correct-horse-9";
let app: Awaited<ReturnType<typeof buildApp>>;
let unconfiguredApp: Awaited<ReturnType<typeof buildApp>>;
let prisma: PrismaClient;
let seq = 0;

async function createProfile(role: "admin" | "member" = "member"): Promise<Profile> {
  seq += 1;
  return prisma.profile.create({
    data: {
      name: `passkey-${Date.now().toString(36)}-${seq}`,
      role,
      passwordHash: await hashPassword(PASSWORD),
      passwordUpdatedAt: new Date(),
    },
  });
}

async function tokenFor(profile: Profile): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { profileId: profile.id, password: PASSWORD },
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ token: string }>().token;
}

function authed(token: string) {
  return { [SESSION_HEADER]: token };
}

function clientData(challenge: string): string {
  return Buffer.from(
    JSON.stringify({ type: "webauthn.create", challenge, origin: CONFIG.origins[0] }),
  ).toString("base64url");
}

function registrationResponse(challenge: string): RegistrationResponseJSON {
  return {
    id: "credential-id",
    rawId: "credential-id",
    response: {
      clientDataJSON: clientData(challenge),
      attestationObject: Buffer.from("not-an-attestation").toString("base64url"),
      transports: ["internal"],
    },
    clientExtensionResults: {},
    type: "public_key",
  } as RegistrationResponseJSON;
}

function authenticationResponse(credentialId: string, challenge: string): AuthenticationResponseJSON {
  return {
    id: credentialId,
    rawId: credentialId,
    response: {
      clientDataJSON: Buffer.from(
        JSON.stringify({ type: "webauthn.get", challenge, origin: CONFIG.origins[0] }),
      ).toString("base64url"),
      authenticatorData: Buffer.from("auth-data").toString("base64url"),
      signature: Buffer.from("signature").toString("base64url"),
      userHandle: undefined,
    },
    clientExtensionResults: {},
    type: "public_key",
  } as AuthenticationResponseJSON;
}

async function storeCredential(profileId: number, credentialId = randomUUID()) {
  return prisma.webAuthnCredential.create({
    data: {
      id: randomUUID(),
      profileId,
      credentialId,
      publicKey: Buffer.from("public-key").toString("base64url"),
      counter: 0,
      transports: JSON.stringify(["internal"]),
      label: "Test passkey",
    },
  });
}

beforeAll(async () => {
  const isCI = process.env.CI === "true";
  if (!isCI) {
    process.env.DATABASE_URL = `file:${dbFile}`;
    const isPostgresUrl = (process.env.DATABASE_URL ?? "").startsWith("postgresql://") || (process.env.DATABASE_URL ?? "").startsWith("postgres://");
    const schemaFlag = isPostgresUrl ? "" : `--schema "${path.join(__dirname, "..", "prisma", "schema.test.prisma")}"`;
    execSync(`npx prisma db push --accept-data-loss ${schemaFlag}`.trim(), {
      cwd: path.join(__dirname, ".."),
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL! },
      stdio: "ignore",
    });
  }
  prisma = new PrismaClient();
  app = await buildApp({ logger: false, appPassword: "household", passkeyConfig: CONFIG });
  unconfiguredApp = await buildApp({
    logger: false,
    appPassword: "household",
    passkeyConfig: null,
  });
}, 120_000);

afterAll(async () => {
  await app.close();
  await unconfiguredApp.close();
  await prisma.$disconnect();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows can hold the SQLite handle briefly */
  }
});

describe("passkey configuration", () => {
  it("is off unless both the RP id and the origin are set", () => {
    expect(passkeyConfigFromEnv({})).toBeNull();
    expect(passkeyConfigFromEnv({ WEBAUTHN_RP_ID: "books.home.arpa" })).toBeNull();
    expect(passkeyConfigFromEnv({ WEBAUTHN_ORIGIN: "https://books.home.arpa" })).toBeNull();
    expect(
      passkeyConfigFromEnv({
        WEBAUTHN_RP_ID: "books.home.arpa",
        WEBAUTHN_ORIGIN: "https://books.home.arpa/",
      }),
    ).toEqual({
      rpId: "books.home.arpa",
      rpName: "Bookle",
      origins: ["https://books.home.arpa"],
    });
  });

  it("accepts more than one origin, comma separated", () => {
    const config = passkeyConfigFromEnv({
      WEBAUTHN_RP_ID: "books.home.arpa",
      WEBAUTHN_ORIGIN: "https://books.home.arpa, https://localhost:5173/",
    });
    expect(config?.origins).toEqual([
      "https://books.home.arpa",
      "https://localhost:5173",
    ]);
  });

  it("only treats a reported counter as a regression when both sides are non-zero", () => {
    expect(isCounterRegression(0, 0)).toBe(false);
    expect(isCounterRegression(0, 5)).toBe(false);
    expect(isCounterRegression(5, 0)).toBe(false);
    expect(isCounterRegression(5, 5)).toBe(true);
    expect(isCounterRegression(5, 4)).toBe(true);
    expect(isCounterRegression(5, 6)).toBe(false);
  });

  it("labels a Windows credential for a person, and anything else as a passkey", () => {
    expect(defaultCredentialLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(
      "Windows Hello",
    );
    expect(defaultCredentialLabel("Mozilla/5.0 (X11; Linux x86_64)")).toBe("Passkey");
    expect(defaultCredentialLabel(null)).toBe("Passkey");
  });

  it("reads the challenge from signed client data and rejects junk", () => {
    expect(challengeFromClientData(clientData("abc123"))).toBe("abc123");
    expect(challengeFromClientData("not-base64-json")).toBeNull();
    expect(
      challengeFromClientData(Buffer.from('{"type":"webauthn.get"}').toString("base64url")),
    ).toBeNull();
  });
});

describe("passkey routes when unconfigured", () => {
  it("answers passkey_not_configured instead of pretending", async () => {
    const response = await unconfiguredApp.inject({
      method: "POST",
      url: "/api/auth/passkeys/login/options",
      payload: {},
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ code: "passkey_not_configured" });
  });

  it("reports configured:false to the settings screen", async () => {
    const profile = await createProfile();
    const token = await tokenFor(profile);
    const response = await unconfiguredApp.inject({
      method: "GET",
      url: "/api/auth/passkeys",
      headers: authed(token),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ configured: false, passkeys: [] });
  });
});

describe("passkey registration", () => {
  it("returns creation options bound to the configured RP and stores one challenge", async () => {
    const profile = await createProfile();
    const token = await tokenFor(profile);
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/passkeys/register/options",
      headers: authed(token),
    });
    expect(response.statusCode).toBe(200);
    const options = response.json<{
      rp: { id: string; name: string };
      user: { name: string };
      challenge: string;
      authenticatorSelection: { authenticatorAttachment: string; userVerification: string };
    }>();
    expect(options.rp).toEqual({ id: CONFIG.rpId, name: CONFIG.rpName });
    expect(options.user.name).toBe(profile.name);
    expect(options.authenticatorSelection).toMatchObject({
      authenticatorAttachment: "platform",
      userVerification: "required",
    });

    const stored = await prisma.webAuthnChallenge.findUnique({
      where: { challenge: options.challenge },
    });
    expect(stored).toMatchObject({ type: "registration", profileId: profile.id });
    expect(stored?.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("requires a signed-in profile", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/passkeys/register/options",
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ code: "auth_required" });
  });

  it("consumes the challenge even when verification fails", async () => {
    const profile = await createProfile();
    const token = await tokenFor(profile);
    const options = (
      await app.inject({
        method: "POST",
        url: "/api/auth/passkeys/register/options",
        headers: authed(token),
      })
    ).json<{ challenge: string }>();

    const body = { response: registrationResponse(options.challenge) };
    const failed = await app.inject({
      method: "POST",
      url: "/api/auth/passkeys/register/verify",
      headers: authed(token),
      payload: body,
    });
    expect(failed.statusCode).toBe(401);
    expect(failed.json()).toEqual({ code: "passkey_failed" });

    const replay = await app.inject({
      method: "POST",
      url: "/api/auth/passkeys/register/verify",
      headers: authed(token),
      payload: body,
    });
    expect(replay.statusCode).toBe(401);
    expect(replay.json()).toEqual({ code: "passkey_failed" });
    expect(
      await prisma.webAuthnChallenge.findUnique({ where: { challenge: options.challenge } }),
    ).toBeNull();
  });
});

describe("passkey login", () => {
  it("refuses options for a profile with no registered passkey", async () => {
    const profile = await createProfile();
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/passkeys/login/options",
      payload: { profileId: profile.id },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ code: "passkey_not_found" });
  });

  it("offers the profile's credentials when it has one", async () => {
    const profile = await createProfile();
    const credential = await storeCredential(profile.id);
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/passkeys/login/options",
      payload: { profileId: profile.id },
    });
    expect(response.statusCode).toBe(200);
    const options = response.json<{
      challenge: string;
      rpId: string;
      allowCredentials: { id: string }[];
    }>();
    expect(options.rpId).toBe(CONFIG.rpId);
    expect(options.allowCredentials.map((entry) => entry.id)).toEqual([
      credential.credentialId,
    ]);
  });

  it("rejects an unknown credential and never creates a session", async () => {
    const options = (
      await app.inject({
        method: "POST",
        url: "/api/auth/passkeys/login/options",
        payload: {},
      })
    ).json<{ challenge: string }>();

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/passkeys/login/verify",
      payload: {
        response: authenticationResponse(randomUUID(), options.challenge),
      },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ code: "passkey_failed" });
    expect(JSON.stringify(response.json())).not.toContain("token");
  });

  it("rejects a challenge issued for a different profile", async () => {
    const owner = await createProfile();
    const other = await createProfile();
    await storeCredential(owner.id);
    const otherCredential = await storeCredential(other.id);

    // The challenge names `owner`; completing it with `other`'s credential must
    // fail before any session is created.
    const options = (
      await app.inject({
        method: "POST",
        url: "/api/auth/passkeys/login/options",
        payload: { profileId: owner.id },
      })
    ).json<{ challenge: string }>();

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/passkeys/login/verify",
      payload: {
        response: authenticationResponse(otherCredential.credentialId, options.challenge),
      },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ code: "passkey_failed" });
    expect(await prisma.session.count({ where: { profileId: other.id } })).toBe(0);
  });
});

describe("passkey management", () => {
  it("lists and removes only the caller's credentials", async () => {
    const profile = await createProfile();
    const token = await tokenFor(profile);
    const mine = await storeCredential(profile.id);
    const theirs = await storeCredential((await createProfile()).id);

    const list = await app.inject({
      method: "GET",
      url: "/api/auth/passkeys",
      headers: authed(token),
    });
    expect(list.statusCode).toBe(200);
    const body = list.json<{ configured: boolean; passkeys: { id: string; label: string }[] }>();
    expect(body.configured).toBe(true);
    expect(body.passkeys.map((entry) => entry.id)).toEqual([mine.id]);

    const refused = await app.inject({
      method: "DELETE",
      url: `/api/auth/passkeys/${theirs.id}`,
      headers: authed(token),
    });
    expect(refused.statusCode).toBe(404);
    expect(refused.json()).toEqual({ code: "passkey_not_found" });

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/auth/passkeys/${mine.id}`,
      headers: authed(token),
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toEqual({ ok: true });

    const again = await app.inject({
      method: "DELETE",
      url: `/api/auth/passkeys/${mine.id}`,
      headers: authed(token),
    });
    expect(again.statusCode).toBe(404);
  });
});
