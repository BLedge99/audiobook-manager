/**
 * Clear the sessions that predate device identity (spec 36).
 *
 * ## What it does
 *
 * The Android app used to add a session row per sign-in, so one phone could
 * fill the "Signed-in devices" panel with dozens of rows. The fix stops new
 * rows being made. This deals with the ones that are already there.
 *
 * For each phone it keeps the newest session and **adopts** it into the
 * device's credential, so the phone keeps working, becomes one row, and its
 * next sign-in reuses the session it already had. The superseded rows are
 * revoked.
 *
 * It is dry-run by default. Nothing is changed without `--apply`.
 *
 * ## What it does not do
 *
 * It only touches rows with `via = "device"`, which are the Android ones.
 * Browser sessions (`via = "profile"`) are real sign-ins from real browsers;
 * the household clears those with "Sign out other devices" in Settings, which
 * is one click rather than a script.
 *
 * ## Usage
 *
 * ```
 * npm run prune:device-sessions            # report only
 * npm run prune:device-sessions -- --apply # revoke the superseded rows
 * ```
 *
 * The client is the one the project generated: PostgreSQL in production,
 * SQLite for local development. Run `npm run db:sqlite:generate` first to
 * point it at the development database.
 */
import { PrismaClient } from "@prisma/client";
import { planDeviceSessionPrune } from "../auth/deviceSessions";

const prisma = new PrismaClient();

async function main() {
  const apply = process.argv.includes("--apply");
  const now = new Date();

  const sessions = await prisma.session.findMany({
    where: { via: "device", revokedAt: null, expiresAt: { gt: now } },
    select: {
      id: true,
      profileId: true,
      userAgent: true,
      deviceCredentialId: true,
      lastUsedAt: true,
    },
    orderBy: { lastUsedAt: "desc" },
  });
  const credentials = await prisma.deviceCredential.findMany({
    where: { revokedAt: null },
    select: { id: true, profileId: true },
  });

  const plan = planDeviceSessionPrune(sessions, credentials);

  console.log(
    `Found ${sessions.length} live device session(s) across ${credentials.length} device credential(s).`,
  );
  console.log(`  Keep:   ${plan.keep.length}`);
  console.log(`  Revoke: ${plan.revoke.length}`);
  console.log(`  Adopt:  ${plan.link.length} session(s) into their device credential`);

  if (plan.revoke.length === 0 && plan.link.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  for (const row of plan.revoke) {
    console.log(`  revoke ${row}`);
  }
  for (const row of plan.link) {
    console.log(`  adopt  ${row.sessionId} -> ${row.credentialId}`);
  }

  if (!apply) {
    console.log("");
    console.log("This was a dry run. Add --apply to make these changes.");
    return;
  }

  if (plan.revoke.length > 0) {
    await prisma.session.updateMany({
      where: { id: { in: plan.revoke } },
      data: { revokedAt: now },
    });
  }
  for (const row of plan.link) {
    await prisma.session.update({
      where: { id: row.sessionId },
      data: { deviceCredentialId: row.credentialId },
    });
  }
  console.log(`Done. Revoked ${plan.revoke.length} session(s).`);
}

main()
  .catch((error) => {
    console.error("Prune failed:", error);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
