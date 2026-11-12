import type { PrismaClient } from "@prisma/client";

/**
 * The personal-data tables owned by a profile, in one place (spec 37, step 6.1).
 *
 * The export, the erasure and the retention purge all read this module so they
 * cannot drift apart (they already disagreed: webAuthnChallenge was erased but
 * not exported). Ordered children-before-profile so deletion runs without FK
 * violations.
 */
export const PROFILE_PERSONAL_DATA_MODELS = [
  "oAuthHandoff",
  "webAuthnChallenge",
  "webAuthnCredential",
  "deviceCredential",
  "session",
  "listeningHistory",
  "playSession",
  "favourite",
  "wishlistItem",
  "profileLibraryEntry",
  "profile",
] as const;

/** Inactive-profile retention: 24 months (approximated as 24 × 30 days). */
export const INACTIVE_PROFILE_RETENTION_MS = 24 * 30 * 24 * 60 * 60 * 1000;

export function inactiveProfileCutoff(now: Date): Date {
  return new Date(now.getTime() - INACTIVE_PROFILE_RETENTION_MS);
}

/**
 * All personal data for one profile (GDPR Art. 15/20). Session-only secrets
 * (token hashes, password hashes) are never included.
 */
export async function exportProfilePersonalData(prisma: PrismaClient, profileId: number) {
  const [profile, sessions, listeningHistory, playSessions, favourites, wishlistItems, libraryEntries, deviceCredentials, webAuthnCredentials, webAuthnChallenges, oAuthHandoffs] = await Promise.all([
    prisma.profile.findUnique({
      where: { id: profileId },
      select: { id: true, name: true, color: true, role: true, createdAt: true, followsServerLibrary: true },
    }),
    prisma.session.findMany({
      where: { profileId },
      select: { id: true, expiresAt: true, userAgent: true, deviceLabel: true, deviceCredentialId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.listeningHistory.findMany({
      where: { profileId },
      select: { id: true, mediaItemId: true, position: true, completed: true, lastPlayed: true, playedAt: true },
      orderBy: { playedAt: "desc" },
    }),
    prisma.playSession.findMany({
      where: { profileId },
      select: { id: true, mediaItemId: true, startedAt: true, endedAt: true, fromPosition: true, toPosition: true, speed: true },
      orderBy: { startedAt: "desc" },
    }),
    prisma.favourite.findMany({
      where: { profileId },
      select: { mediaItemId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.wishlistItem.findMany({
      where: { profileId },
      select: { id: true, title: true, author: true, seedMediaItemId: true, owned: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.profileLibraryEntry.findMany({
      where: { profileId },
      select: { mediaItemId: true },
      orderBy: { mediaItemId: "asc" },
    }),
    prisma.deviceCredential.findMany({
      where: { profileId },
      select: { label: true, deviceId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.webAuthnCredential.findMany({
      where: { profileId },
      select: { credentialId: true, publicKey: true, counter: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.webAuthnChallenge.findMany({
      where: { profileId },
      select: { id: true, type: true, expiresAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    // No code/state hashes: like token hashes, they are artefacts of a live
    // flow, not data worth surfacing to the listener.
    prisma.oAuthHandoff.findMany({
      where: { profileId },
      select: { id: true, createdAt: true, expiresAt: true, consumedAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  if (!profile) return null;

  return {
    exportedAt: new Date().toISOString(),
    profile,
    sessions,
    listeningHistory,
    playSessions,
    favourites,
    wishlistItems,
    libraryEntries,
    deviceCredentials,
    webAuthnCredentials,
    webAuthnChallenges,
    oAuthHandoffs,
  };
}

/** Erase every personal-data row owned by one profile (GDPR Art. 17). */
export async function eraseProfilePersonalData(prisma: PrismaClient, profileId: number): Promise<void> {
  await prisma.$transaction([
    prisma.oAuthHandoff.deleteMany({ where: { profileId } }),
    prisma.webAuthnChallenge.deleteMany({ where: { profileId } }),
    prisma.webAuthnCredential.deleteMany({ where: { profileId } }),
    prisma.deviceCredential.deleteMany({ where: { profileId } }),
    prisma.session.deleteMany({ where: { profileId } }),
    prisma.listeningHistory.deleteMany({ where: { profileId } }),
    prisma.playSession.deleteMany({ where: { profileId } }),
    prisma.favourite.deleteMany({ where: { profileId } }),
    prisma.wishlistItem.deleteMany({ where: { profileId } }),
    prisma.profileLibraryEntry.deleteMany({ where: { profileId } }),
    prisma.profile.delete({ where: { id: profileId } }),
  ]);
}

/** Delete expired/revoked personal-data auth artifacts (best effort). */
export async function cleanupExpiredPersonalDataArtifacts(prisma: PrismaClient, now: Date): Promise<void> {
  await prisma.session.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: now } }, { revokedAt: { not: null } }],
    },
  });
  await prisma.webAuthnChallenge.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  // Spec 32 / ADR 030: native OAuth handoffs. Single-use and 60-second TTL;
  // expired rows are worthless and hold only hashes and a profile id.
  await prisma.oAuthHandoff.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  await prisma.deviceCredential.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: now } }, { revokedAt: { not: null } }],
    },
  });
}

/**
 * Delete inactive profiles and all their personal data (retention). A profile
 * is inactive when it has not been active for the retention window, or was
 * never used and was created before the window.
 */
export async function purgeInactiveProfiles(prisma: PrismaClient, now: Date): Promise<void> {
  const cutoff = inactiveProfileCutoff(now);
  const inactiveProfiles = await prisma.profile.findMany({
    where: {
      OR: [
        { lastActiveAt: { lt: cutoff } },
        { lastActiveAt: null, createdAt: { lt: cutoff } },
      ],
    },
    select: { id: true },
  });
  for (const profile of inactiveProfiles) {
    await eraseProfilePersonalData(prisma, profile.id);
  }
}
