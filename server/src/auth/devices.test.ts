import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient, type Profile } from "@prisma/client";
import { buildApp, SESSION_HEADER } from "../app";
import { hashPassword } from "../auth/password";
import { createTestDatabase } from "../test-support/database";

/**
 * Spec 36: a session belongs to a device, not to a sign-in.
 *
 * Before this spec, exchanging a device secret inserted a session row every
 * time, so an Android phone that signed in once a day appeared once a day in
 * the "Signed-in devices" panel. The panel now lists devices, and a device
 * holds one session whose token is rotated on each use.
 */

const db = createTestDatabase("audiobook-device-identity-test-");
const dir = db.dir;

let app: Awaited<ReturnType<typeof buildApp>>;
let prisma: PrismaClient;
let seq = 0;

const PASSWORD = "correct-horse-9";

async function createProfile(role: "admin" | "member" = "member"): Promise<Profile> {
  seq += 1;
  return prisma.profile.create({
    data: {
      name: `device-${Date.now().toString(36)}-${seq}`,
      role,
      passwordHash: await hashPassword(PASSWORD),
      passwordUpdatedAt: new Date(),
    },
  });
}

async function login(profile: Profile) {
  return app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { profileId: profile.id, password: PASSWORD },
  });
}

function tokenOf(response: Awaited<ReturnType<typeof login>>): string {
  return response.json<{ token: string }>().token;
}

/** Enrol a device and return its id and secret. */
async function enrol(profile: Profile, token: string, label = "Pixel test device", deviceId?: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/devices",
    headers: { [SESSION_HEADER]: token },
    payload: deviceId ? { label, deviceId } : { label },
  });
  expect(res.statusCode).toBe(200);
  return res.json<{ id: string; secret: string; label: string; deviceId: string | null }>();
}

async function exchange(secret: string) {
  return app.inject({
    method: "POST",
    url: "/api/auth/devices/session",
    payload: { secret },
    headers: { "user-agent": "Mozilla/5.0 (Linux; Android 13; Pixel 4a) Chrome/120" },
  });
}

interface DeviceRow {
  key: string;
  label: string | null;
  deviceId: string | null;
  via: string;
  createdAt: string;
  lastActiveAt: string;
  current: boolean;
  sessions: number;
}

beforeAll(async () => {
  prisma = new PrismaClient();
  app = await buildApp({ logger: false, appPassword: "household", mediaTokenSecret: "m".repeat(32), prisma });
}, 120_000);

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  db.cleanup();
});

describe("one session per device", () => {
  it("reuses the device's session and rotates the token instead of adding a row", async () => {
    const profile = await createProfile();
    const credential = await enrol(profile, tokenOf(await login(profile)));

    const first = await exchange(credential.secret);
    expect(first.statusCode).toBe(200);
    const firstToken = first.json<{ token: string }>().token;

    const second = await exchange(credential.secret);
    expect(second.statusCode).toBe(200);
    const secondToken = second.json<{ token: string }>().token;

    expect(secondToken).not.toBe(firstToken);

    const sessions = await prisma.session.findMany({
      where: { profileId: profile.id, via: "device" },
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].deviceCredentialId).toBe(credential.id);

    // The first token stops working the moment the second is issued: only the
    // hash is stored, so a token cannot be re-issued.
    const stale = await app.inject({
      method: "GET", url: "/api/auth/session", headers: { [SESSION_HEADER]: firstToken },
    });
    expect(stale.statusCode).toBe(401);

    const live = await app.inject({
      method: "GET", url: "/api/auth/session", headers: { [SESSION_HEADER]: secondToken },
    });
    expect(live.statusCode).toBe(200);
    expect(live.json()).toMatchObject({ via: "device", profile: { id: profile.id } });
  });

  it("keeps the first sign-in date and the 90-day cap measured from it", async () => {
    const profile = await createProfile();
    const credential = await enrol(profile, tokenOf(await login(profile)));
    await exchange(credential.secret);

    const first = await prisma.session.findFirst({
      where: { profileId: profile.id, via: "device" },
    });
    expect(first).not.toBeNull();

    await exchange(credential.secret);

    const second = await prisma.session.findFirst({
      where: { profileId: profile.id, via: "device" },
    });
    expect(second?.id).toBe(first?.id);
    expect(second?.createdAt.getTime()).toBe(first?.createdAt.getTime());
    // The expiry slides with use but never past 90 days from creation.
    const cap = (first?.createdAt.getTime() ?? 0) + 90 * 24 * 60 * 60 * 1000;
    expect(second!.expiresAt.getTime()).toBeLessThanOrEqual(cap);
  });

  it("gives two devices two independent sessions", async () => {
    const profile = await createProfile();
    const token = tokenOf(await login(profile));
    const phone = await enrol(profile, token, "Pixel 4a");
    const tablet = await enrol(profile, token, "Tab S9");

    await exchange(phone.secret);
    await exchange(tablet.secret);

    const sessions = await prisma.session.findMany({
      where: { profileId: profile.id, via: "device" },
    });
    expect(sessions).toHaveLength(2);
    expect(new Set(sessions.map((row) => row.deviceCredentialId))).toEqual(
      new Set([phone.id, tablet.id]),
    );
  });

  it("adopts the enrolling browser session into the device credential", async () => {
    const profile = await createProfile();
    const token = tokenOf(await login(profile));
    // Enrollment happens on the sign-in's behalf (it is the browser's own
    // phone enrolling itself), so the sign-in becomes the device's session.
    const credential = await enrol(profile, token, "Pixel 4a");

    const session = await prisma.session.findFirstOrThrow({
      where: { profileId: profile.id },
    });
    expect(session.deviceCredentialId).toBe(credential.id);
    expect(session.via).toBe("device");
  });
});

describe("the signed-in devices panel", () => {
  it("lists devices rather than sign-ins", async () => {
    const profile = await createProfile();
    const token = tokenOf(await login(profile));
    const credential = await enrol(profile, token, "Pixel 4a", "installation-abc");

    // Five sign-ins on one phone: one device, not five rows. Each exchange
    // rotates the adopted session, so the latest token is the one that works.
    let deviceToken = tokenOf(await exchange(credential.secret));
    for (let attempt = 0; attempt < 4; attempt += 1) deviceToken = tokenOf(await exchange(credential.secret));

    const res = await app.inject({
      method: "GET", url: "/api/auth/sessions", headers: { [SESSION_HEADER]: deviceToken },
    });
    expect(res.statusCode).toBe(200);
    const devices = res.json<{ devices: DeviceRow[] }>().devices;

    const phone = devices.find((entry) => entry.key === credential.id);
    expect(phone).toBeDefined();
    expect(phone?.label).toBe("Pixel 4a");
    expect(phone?.deviceId).toBe("installation-abc");
    expect(phone?.sessions).toBe(1);
    expect(phone?.via).toBe("device");
    // Enrolling adopts the enrolling sign-in into the credential, so it no
    // longer lists as a separate device of its own.
    expect(phone?.current).toBe(true);
    expect(devices.some((entry) => entry.via === "profile")).toBe(false);
  });

  it("signs one device out and leaves the others alone", async () => {
    const profile = await createProfile();
    const token = tokenOf(await login(profile));
    const phone = await enrol(profile, token, "Pixel 4a");
    const tablet = await enrol(profile, token, "Tab S9");
    // Enrolling adopted the login session into the phone credential; the
    // tablet's first exchange mints its own session.
    const phoneToken = tokenOf(await exchange(phone.secret));
    await exchange(tablet.secret);

    const res = await app.inject({
      method: "DELETE",
      url: `/api/auth/sessions/device/${phone.id}`,
      headers: { [SESSION_HEADER]: phoneToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, revoked: 1 });

    const remaining = await prisma.session.findMany({
      where: { profileId: profile.id, revokedAt: null },
    });
    expect(remaining.some((row) => row.deviceCredentialId === phone.id)).toBe(false);
    expect(remaining.some((row) => row.deviceCredentialId === tablet.id)).toBe(true);
  });

  it("signs every other device out and leaves the caller's own session alone", async () => {
    const profile = await createProfile();
    const token = tokenOf(await login(profile));
    const phone = await enrol(profile, token, "Pixel 4a");
    // Enrolling adopted the login session into the phone credential and
    // each exchange rotates its token; thread the live one through.
    const phoneToken = tokenOf(await exchange(phone.secret));
    // One other device so "others" has something to revoke.
    const tablet = await enrol(profile, phoneToken, "Tab S9");
    await exchange(tablet.secret);

    const res = await app.inject({
      method: "DELETE", url: "/api/auth/sessions/others", headers: { [SESSION_HEADER]: phoneToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, revoked: 1 });

    const remaining = await prisma.session.findMany({
      where: { profileId: profile.id, revokedAt: null },
    });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).not.toBe(phone.id);
    // The caller's own session still works.
    const still = await app.inject({
      method: "GET", url: "/api/auth/session", headers: { [SESSION_HEADER]: phoneToken },
    });
    expect(still.statusCode).toBe(200);
  });

  it("does not let one profile sign out another profile's device", async () => {
    const owner = await createProfile();
    const other = await createProfile();
    const ownerToken = tokenOf(await login(owner));
    const credential = await enrol(owner, ownerToken, "Pixel 4a");
    await exchange(credential.secret);

    const otherToken = tokenOf(await login(other));
    const res = await app.inject({
      method: "DELETE",
      url: `/api/auth/sessions/device/${credential.id}`,
      headers: { [SESSION_HEADER]: otherToken },
    });
    expect(res.statusCode).toBe(404);

    const still = await prisma.session.findFirst({
      where: { profileId: owner.id, deviceCredentialId: credential.id, revokedAt: null },
    });
    expect(still).not.toBeNull();
  });
});

describe("re-enrolling the same device", () => {
  it("rotates the credential instead of adding a second one", async () => {
    const profile = await createProfile();
    const token = tokenOf(await login(profile));

    const first = await enrol(profile, token, "Pixel 4a", "installation-abc");
    const second = await enrol(profile, token, "Pixel 4a", "installation-abc");

    expect(second.id).toBe(first.id);
    expect(second.secret).not.toBe(first.secret);

    const credentials = await prisma.deviceCredential.findMany({
      where: { profileId: profile.id },
    });
    expect(credentials).toHaveLength(1);

    // The old secret stops working: it is the same credential, with a new one.
    const stale = await exchange(first.secret);
    expect(stale.statusCode).toBe(401);
    expect(stale.json()).toMatchObject({ code: "device_auth_failed" });

    const live = await exchange(second.secret);
    expect(live.statusCode).toBe(200);
  });

  it("gives two phones on the same model two credentials", async () => {
    const profile = await createProfile();
    const token = tokenOf(await login(profile));

    await enrol(profile, token, "Pixel 4a", "installation-one");
    await enrol(profile, token, "Pixel 4a", "installation-two");

    const credentials = await prisma.deviceCredential.findMany({
      where: { profileId: profile.id },
    });
    expect(credentials).toHaveLength(2);
  });
});

describe("revoking a device credential", () => {
  it("ends the sessions the device holds", async () => {
    const profile = await createProfile();
    const token = tokenOf(await login(profile));
    const credential = await enrol(profile, token, "Pixel 4a");
    // Enrolling adopted the login session into the credential; the exchange
    // rotates its token, so the original login token no longer validates.
    const deviceToken = tokenOf(await exchange(credential.secret));

    const revoked = await app.inject({
      method: "DELETE", url: `/api/auth/devices/${credential.id}`, headers: { [SESSION_HEADER]: deviceToken },
    });
    expect(revoked.statusCode).toBe(200);

    const dead = await app.inject({
      method: "GET", url: "/api/auth/session", headers: { [SESSION_HEADER]: deviceToken },
    });
    expect(dead.statusCode).toBe(401);
  });
});
