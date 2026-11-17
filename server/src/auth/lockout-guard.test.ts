import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { AuthService } from "./service";
import { createTestDatabase } from "../test-support/database";

/**
 * Spec 45, phase 9 — the lockout pair cannot resurrect a cleared lock.
 *
 * Two statements are needed to escalate a failure into a lock: the count
 * increment, then the lockedUntil write. Between them an operator unlock can
 * land and reset the counter; the failure path must not then write a lock the
 * operator already cleared. The guard lives in the second write itself —
 * it re-checks the *current* counter, atomically, in one statement.
 */
const db = createTestDatabase("audiobook-lockout-guard-");
const clock = new Date("2026-11-17T00:00:00.000Z");

let prisma: PrismaClient;
let auth: AuthService;
let profileId: number;

beforeAll(async () => {
  prisma = new PrismaClient();
  auth = new AuthService({ prisma, now: () => clock });
  const profile = await prisma.profile.create({
    data: { name: "guard-test", failedLoginCount: 0, lockedUntil: null },
  });
  profileId = profile.id;
});

afterAll(async () => {
  await prisma.$disconnect();
  db.cleanup();
});

describe("applyLockIfCountMet (spec 45 phase 9)", () => {
  it("does not resurrect a lock the operator has cleared", async () => {
    // Failure path computed the lock against a count of 5 — meanwhile unlock
    // reset the counter to 0. The late second write must match zero rows.
    await prisma.profile.update({
      where: { id: profileId },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
    await (auth as unknown as { applyLockIfCountMet: (id: number, until: Date) => Promise<void> })
      .applyLockIfCountMet(profileId, new Date(clock.getTime() + 60_000));
    const after = await prisma.profile.findUniqueOrThrow({
      where: { id: profileId },
      select: { lockedUntil: true },
    });
    expect(after.lockedUntil).toBeNull();
  });

  it("applies the lock while the counter still meets the threshold", async () => {
    await prisma.profile.update({
      where: { id: profileId },
      data: { failedLoginCount: 5, lockedUntil: null },
    });
    const locked = new Date(clock.getTime() + 60_000);
    await (auth as unknown as { applyLockIfCountMet: (id: number, until: Date) => Promise<void> })
      .applyLockIfCountMet(profileId, locked);
    const after = await prisma.profile.findUniqueOrThrow({
      where: { id: profileId },
      select: { lockedUntil: true },
    });
    expect(after.lockedUntil?.getTime()).toBe(locked.getTime());
  });
});
