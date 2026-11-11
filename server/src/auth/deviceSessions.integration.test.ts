import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { buildApp, SESSION_HEADER } from "../app";
import { hashPassword } from "../auth/password";
import { hashSessionToken } from "../auth/session";
import { planDeviceSessionPrune } from "../auth/deviceSessions";
import { createTestDatabase } from "../test-support/database";

/**
 * Spec 36: the cleanup for a household that already has the pile.
 *
 * The plan is applied to real rows here, and the last step is the one that
 * matters: after a phone's surviving session is adopted into its credential,
 * the next biometric sign-in reuses that session instead of adding a row.
 */

const db = createTestDatabase("audiobook-prune-test-");
const dir = db.dir;

let app: Awaited<ReturnType<typeof buildApp>>;
let prisma: PrismaClient;
let seq = 0;

const PASSWORD = "correct-horse-9";
const AGENT = "Mozilla/5.0 (Linux; Android 13; Pixel 4a Build/TQ3A) Chrome/120";

async function createProfile() {
  seq += 1;
  return prisma.profile.create({
    data: {
      name: `prune-${Date.now().toString(36)}-${seq}`,
      role: "member",
      passwordHash: await hashPassword(PASSWORD),
      passwordUpdatedAt: new Date(),
    },
  });
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

describe("pruning the sessions that predate device identity", () => {
  it("leaves one live session for the phone, and the next sign-in reuses it", async () => {
    const profile = await createProfile();
    const deviceSecret = `device-secret-${profile.id}-${"x".repeat(32)}`;
    const credential = await prisma.deviceCredential.create({
      data: {
        id: `credential-${profile.id}`,
        profileId: profile.id,
        secretHash: hashSessionToken(deviceSecret),
        label: "Pixel 4a",
        expiresAt: new Date(Date.now() + 90 * 86_400_000),
      },
    });

    // Four sign-ins from one phone, all before device identity existed.
    for (let index = 0; index < 4; index += 1) {
      await prisma.session.create({
        data: {
          id: `legacy-${profile.id}-${index}`,
          tokenHash: hashSessionToken(`legacy-token-${profile.id}-${index}`),
          profileId: profile.id,
          via: "device",
          userAgent: AGENT,
          deviceLabel: "Android device",
          createdAt: new Date(Date.now() - (10 - index) * 86_400_000),
          lastUsedAt: new Date(Date.now() - (10 - index) * 86_400_000),
          expiresAt: new Date(Date.now() + 30 * 86_400_000),
        },
      });
    }

    const sessions = await prisma.session.findMany({
      where: { profileId: profile.id, via: "device" },
      select: { id: true, profileId: true, userAgent: true, deviceCredentialId: true, lastUsedAt: true },
    });
    const credentials = await prisma.deviceCredential.findMany({
      where: { profileId: profile.id },
      select: { id: true, profileId: true },
    });
    const plan = planDeviceSessionPrune(sessions, credentials);

    expect(plan.keep).toHaveLength(1);
    expect(plan.revoke).toHaveLength(3);
    expect(plan.link).toEqual([
      { sessionId: plan.keep[0], credentialId: credential.id },
    ]);

    // Apply it.
    const now = new Date();
    await prisma.session.updateMany({
      where: { id: { in: plan.revoke } },
      data: { revokedAt: now },
    });
    for (const row of plan.link) {
      await prisma.session.update({
        where: { id: row.sessionId },
        data: { deviceCredentialId: row.credentialId },
      });
    }

    // The next biometric sign-in reuses the adopted session.
    const exchange = await app.inject({
      method: "POST",
      url: "/api/auth/devices/session",
      payload: { secret: deviceSecret },
      headers: { "user-agent": AGENT },
    });
    expect(exchange.statusCode).toBe(200);

    const live = await prisma.session.findMany({
      where: { profileId: profile.id, via: "device", revokedAt: null },
      select: { id: true, deviceCredentialId: true },
    });
    expect(live).toHaveLength(1);
    expect(live[0].id).toBe(plan.keep[0]);
    expect(live[0].deviceCredentialId).toBe(credential.id);
  });

  it("leaves browser sessions alone", async () => {
    const profile = await createProfile();
    await prisma.session.create({
      data: {
        id: `browser-${profile.id}`,
        tokenHash: hashSessionToken(`browser-token-${profile.id}`),
        profileId: profile.id,
        via: "profile",
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140",
        deviceLabel: "Windows device",
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      },
    });

    const sessions = await prisma.session.findMany({
      where: { profileId: profile.id },
      select: { id: true, profileId: true, userAgent: true, deviceCredentialId: true, lastUsedAt: true },
    });
    const plan = planDeviceSessionPrune(sessions, []);
    expect(plan.revoke).not.toContain(`browser-${profile.id}`);
  });
});
