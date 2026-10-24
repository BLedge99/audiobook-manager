import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient, type Profile } from "@prisma/client";
import { buildApp, SESSION_HEADER } from "./app";
import { hashPassword } from "./auth/password";

const dir = mkdtempSync(path.join(tmpdir(), "audiobook-auth-test-"));
const dbFile = path.join(dir, "test.db");
process.env.DATABASE_URL = `file:${dbFile}`;

let app: Awaited<ReturnType<typeof buildApp>>;
const prisma = new PrismaClient();
let seq = 0;

const PASSWORD = "correct-horse-9";

async function createProfile(role: "admin" | "member" = "member", password: string | null = PASSWORD): Promise<Profile> {
  seq += 1;
  return prisma.profile.create({
    data: {
      name: `auth-${Date.now().toString(36)}-${seq}`,
      role,
      passwordHash: password ? await hashPassword(password) : null,
      passwordUpdatedAt: password ? new Date() : null,
    },
  });
}

async function login(profile: Profile, password = PASSWORD) {
  return app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { profileId: profile.id, password },
  });
}

async function loginHousehold() {
  return app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { password: "household" },
  });
}

function tokenOf(response: Awaited<ReturnType<typeof login>>): string {
  return response.json<{ token: string }>().token;
}

beforeAll(async () => {
  execSync("npx prisma migrate deploy", {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: `file:${dbFile}` },
    stdio: "ignore",
  });
  app = await buildApp({ logger: false, appPassword: "household" });
}, 120_000);

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows can hold the SQLite handle briefly */
  }
});

describe("account list", () => {
  it("is public and never exposes a password hash", async () => {
    const profile = await createProfile();
    const res = await app.inject({ method: "GET", url: "/api/auth/accounts" });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ id: number; name: string; hasPassword: boolean }[]>();
    const row = body.find((entry) => entry.id === profile.id);
    expect(row).toMatchObject({ name: profile.name, hasPassword: true, role: "member" });
    expect(JSON.stringify(body)).not.toContain("passwordHash");
    expect(JSON.stringify(body)).not.toContain("scrypt$");
  });
});

describe("profile login", () => {
  it("creates a session and returns the profile", async () => {
    const profile = await createProfile();
    const res = await login(profile);
    expect(res.statusCode).toBe(200);
    const body = res.json<{ token: string; role: string; profile: { id: number } }>();
    expect(body.token.length).toBeGreaterThan(20);
    expect(body.role).toBe("member");
    expect(body.profile.id).toBe(profile.id);

    const session = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { [SESSION_HEADER]: body.token },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json<{ profile: { id: number } }>().profile.id).toBe(profile.id);
  });

  it("answers a wrong password and an unknown profile the same way", async () => {
    const profile = await createProfile();
    const wrong = await login(profile, "not-the-password");
    const unknown = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { profileId: 999_999, password: "not-the-password" },
    });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual({ code: "incorrect_password" });
    expect(unknown.json()).toEqual({ code: "incorrect_password" });
  });

  it("refuses an unclaimed profile with a setup code, not a wrong-password sentence", async () => {
    const profile = await createProfile("member", null);
    const res = await login(profile, "anything-8");
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ code: "profile_unclaimed" });
  });

  it("uses the session profile, not x-profile-id, for a member", async () => {
    const a = await createProfile();
    const b = await createProfile();
    const root = await prisma.libraryRoot.create({
      data: { path: path.join(dir, `library-${Date.now().toString(36)}-${seq}`) },
    });
    const bookA = await prisma.mediaItem.create({
      data: {
        title: "Book A",
        author: "Author",
        filePath: "a.mp3",
        fileFormat: "mp3",
        libraryRootId: root.id,
      },
    });
    const bookB = await prisma.mediaItem.create({
      data: {
        title: "Book B",
        author: "Author",
        filePath: "b.mp3",
        fileFormat: "mp3",
        libraryRootId: root.id,
      },
    });
    await prisma.favourite.create({ data: { profileId: a.id, mediaItemId: bookA.id } });
    await prisma.favourite.create({ data: { profileId: b.id, mediaItemId: bookB.id } });

    const token = tokenOf(await login(a));
    const res = await app.inject({
      method: "GET",
      url: "/api/favourites/ids",
      headers: { [SESSION_HEADER]: token, "x-profile-id": String(b.id) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<number[]>()).toEqual([bookA.id]);
  });
});

describe("Android device credentials", () => {
  it("stores only the secret hash, exchanges a valid secret, and rejects it after revocation", async () => {
    const profile = await createProfile();
    const signedIn = await login(profile);
    const headers = { [SESSION_HEADER]: tokenOf(signedIn) };

    const enrollment = await app.inject({
      method: "POST", url: "/api/auth/devices", headers,
      payload: { label: "Pixel test device" },
    });
    expect(enrollment.statusCode).toBe(200);
    const credential = enrollment.json<{ id: string; secret: string }>();
    expect(credential.secret).toHaveLength(43);
    const stored = await prisma.deviceCredential.findUnique({ where: { id: credential.id } });
    expect(stored?.secretHash).not.toBe(credential.secret);

    const listing = await app.inject({ method: "GET", url: "/api/auth/devices", headers });
    expect(listing.json()).toMatchObject({ devices: [{ id: credential.id, label: "Pixel test device" }] });
    expect(JSON.stringify(listing.json())).not.toContain(credential.secret);

    const exchange = await app.inject({
      method: "POST", url: "/api/auth/devices/session", payload: { secret: credential.secret },
    });
    expect(exchange.statusCode).toBe(200);
    const session = exchange.json<{ token: string; profile: { id: number } }>();
    expect(session.profile.id).toBe(profile.id);
    const sessionInfo = await app.inject({
      method: "GET", url: "/api/auth/session", headers: { [SESSION_HEADER]: session.token },
    });
    expect(sessionInfo.json()).toMatchObject({ via: "device", profile: { id: profile.id } });

    const revoked = await app.inject({
      method: "DELETE", url: `/api/auth/devices/${credential.id}`, headers,
    });
    expect(revoked.statusCode).toBe(200);
    const rejected = await app.inject({
      method: "POST", url: "/api/auth/devices/session", payload: { secret: credential.secret },
    });
    expect(rejected.statusCode).toBe(401);
    expect(rejected.json()).toMatchObject({ code: "device_auth_failed" });
  });

  it("does not let one profile list or revoke another profile's device", async () => {
    const owner = await createProfile();
    const other = await createProfile();
    const ownerLogin = await login(owner);
    const ownerHeaders = { [SESSION_HEADER]: tokenOf(ownerLogin) };
    const enrollment = await app.inject({
      method: "POST", url: "/api/auth/devices", headers: ownerHeaders, payload: {},
    });
    const credential = enrollment.json<{ id: string }>();
    const otherLogin = await login(other);
    const otherHeaders = { [SESSION_HEADER]: tokenOf(otherLogin) };

    const listing = await app.inject({ method: "GET", url: "/api/auth/devices", headers: otherHeaders });
    expect(listing.json()).toEqual({ devices: [] });
    const revoked = await app.inject({
      method: "DELETE", url: `/api/auth/devices/${credential.id}`, headers: otherHeaders,
    });
    expect(revoked.statusCode).toBe(404);
    const stillListed = await app.inject({ method: "GET", url: "/api/auth/devices", headers: ownerHeaders });
    expect(stillListed.json()).toMatchObject({ devices: [{ id: credential.id }] });
  });
});

describe("roles", () => {
  it("refuses an admin route to a member and allows an admin", async () => {
    const member = await createProfile();
    const admin = await createProfile("admin");

    const memberRes = await app.inject({
      method: "POST",
      url: "/api/profiles",
      headers: { [SESSION_HEADER]: tokenOf(await login(member)) },
      payload: { name: `Denied ${Date.now()}` },
    });
    expect(memberRes.statusCode).toBe(403);
    expect(memberRes.json()).toEqual({ code: "forbidden" });

    const adminRes = await app.inject({
      method: "POST",
      url: "/api/profiles",
      headers: { [SESSION_HEADER]: tokenOf(await login(admin)) },
      payload: { name: `Allowed ${Date.now()}` },
    });
    expect(adminRes.statusCode).toBe(201);
    expect(adminRes.json()).not.toHaveProperty("passwordHash");
  });

  it("lets the break-glass session act as an admin during the migration", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/profiles",
      headers: { [SESSION_HEADER]: tokenOf(await loginHousehold()) },
      payload: { name: `Household ${Date.now()}` },
    });
    expect(res.statusCode).toBe(201);
  });
});

describe("claim and password changes", () => {
  it("claims an unclaimed profile with the household key and refuses a second claim", async () => {
    const profile = await createProfile("member", null);
    const claim = await app.inject({
      method: "POST",
      url: "/api/auth/claim",
      payload: {
        profileId: profile.id,
        householdPassword: "household",
        newPassword: "claim-password-9",
      },
    });
    expect(claim.statusCode).toBe(200);
    const token = claim.json<{ token: string }>().token;
    expect((await login(profile, "claim-password-9")).statusCode).toBe(200);

    const again = await app.inject({
      method: "POST",
      url: "/api/auth/claim",
      payload: {
        profileId: profile.id,
        householdPassword: "household",
        newPassword: "another-password-9",
      },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ code: "claim_unavailable" });
    expect(token.length).toBeGreaterThan(20);
  });

  it("rejects a 7-character password and accepts 8", async () => {
    const profile = await createProfile("member", null);
    const short = await app.inject({
      method: "POST",
      url: "/api/auth/claim",
      payload: {
        profileId: profile.id,
        householdPassword: "household",
        newPassword: "1234567",
      },
    });
    expect(short.statusCode).toBe(400);
    expect(short.json()).toEqual({
      code: "password_too_short",
      params: { minLength: 8 },
    });

    const exact = await app.inject({
      method: "POST",
      url: "/api/auth/claim",
      payload: {
        profileId: profile.id,
        householdPassword: "household",
        newPassword: "abcdefgh",
      },
    });
    // 8 characters is allowed even though it is not strong; the common list
    // rejects the obvious ones, not every short numeric string.
    expect(exact.statusCode).toBe(200);
  });

  it("changes a password, keeps the current session, revokes the others", async () => {
    const profile = await createProfile();
    const first = tokenOf(await login(profile));
    const second = tokenOf(await login(profile));

    const changed = await app.inject({
      method: "POST",
      url: "/api/auth/password",
      headers: { [SESSION_HEADER]: first },
      payload: { currentPassword: PASSWORD, newPassword: "changed-password-9" },
    });
    expect(changed.statusCode).toBe(200);

    const oldPassword = await login(profile, PASSWORD);
    expect(oldPassword.statusCode).toBe(401);
    expect((await login(profile, "changed-password-9")).statusCode).toBe(200);

    const current = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { [SESSION_HEADER]: first },
    });
    expect(current.statusCode).toBe(200);
    const other = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { [SESSION_HEADER]: second },
    });
    expect(other.statusCode).toBe(401);
  });
});

describe("lockout and reset", () => {
  it("locks after five failures and an admin can unlock", async () => {
    const profile = await createProfile();
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      expect((await login(profile, "wrong-password-9")).statusCode).toBe(401);
    }
    const fifth = await login(profile, "wrong-password-9");
    expect(fifth.statusCode).toBe(429);
    expect(fifth.json()).toMatchObject({ code: "account_locked" });
    expect(fifth.headers["retry-after"]).toBeTruthy();

    const locked = await login(profile, PASSWORD);
    expect(locked.statusCode).toBe(429);

    const admin = await createProfile("admin");
    const unlock = await app.inject({
      method: "POST",
      url: `/api/auth/accounts/${profile.id}/unlock`,
      headers: { [SESSION_HEADER]: tokenOf(await login(admin)) },
    });
    expect(unlock.statusCode).toBe(200);
    expect((await login(profile, PASSWORD)).statusCode).toBe(200);
  });

  it("admin reset changes the password and revokes every session", async () => {
    const profile = await createProfile();
    const oldToken = tokenOf(await login(profile));
    const admin = await createProfile("admin");

    const reset = await app.inject({
      method: "POST",
      url: `/api/auth/accounts/${profile.id}/reset`,
      headers: { [SESSION_HEADER]: tokenOf(await login(admin)) },
      payload: { newPassword: "reset-password-9" },
    });
    expect(reset.statusCode).toBe(200);
    expect((await login(profile, PASSWORD)).statusCode).toBe(401);
    expect((await login(profile, "reset-password-9")).statusCode).toBe(200);

    const oldSession = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { [SESSION_HEADER]: oldToken },
    });
    expect(oldSession.statusCode).toBe(401);
  });
});

describe("sessions", () => {
  it("lists and revokes the caller's sessions", async () => {
    const profile = await createProfile();
    const first = tokenOf(await login(profile));
    const second = tokenOf(await login(profile));

    const list = await app.inject({
      method: "GET",
      url: "/api/auth/sessions",
      headers: { [SESSION_HEADER]: first },
    });
    expect(list.statusCode).toBe(200);
    const sessions = list.json<{
      sessions: { id: string; current: boolean }[];
    }>().sessions;
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((session) => session.current)).toHaveLength(1);

    const other = sessions.find((session) => !session.current);
    expect(other).toBeTruthy();
    const revoke = await app.inject({
      method: "DELETE",
      url: `/api/auth/sessions/${other?.id}`,
      headers: { [SESSION_HEADER]: first },
    });
    expect(revoke.statusCode).toBe(200);

    const revoked = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { [SESSION_HEADER]: second },
    });
    expect(revoked.statusCode).toBe(401);
  });
});

describe("gate", () => {
  it("keeps public API endpoints open and the rest closed", async () => {
    expect((await app.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/auth/accounts" })).statusCode).toBe(200);
    const closed = await app.inject({ method: "GET", url: "/api/audiobooks" });
    expect(closed.statusCode).toBe(401);
    expect(closed.json()).toEqual({ code: "auth_required" });
  });
});
