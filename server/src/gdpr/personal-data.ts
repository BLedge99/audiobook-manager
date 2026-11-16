import type { PrismaClient } from "@prisma/client";

/**
 * The personal-data tables owned by a profile, in one place (spec 37, step 6.1;
 * made fully declarative in spec 41 phase 5).
 *
 * The export, the erasure and the schema guard all derive from
 * `PERSONAL_DATA_ROWS`, so they cannot drift apart: add a profile-id-bearing
 * Prisma model without a row and the suite fails; add a row without an erase
 * strategy and the suite fails. (They already disagreed once: webAuthnChallenge
 * was erased but not exported.)
 *
 * `model` is the Prisma delegate name (camelCase of the model). `key` is the
 * top-level key in the export payload. Ordered children-before-profile so
 * erasure runs without FK violations.
 */
export interface PersonalDataRow {
  model: string;
  key: string;
  find: "unique" | "many";
  select: Record<string, true>;
  orderBy?: Record<string, "asc" | "desc">;
  erase: "deleteMany" | "delete";
}

export const PERSONAL_DATA_ROWS: ReadonlyArray<PersonalDataRow> = Object.freeze<PersonalDataRow[]>([
  { model: "oAuthHandoff", key: "oAuthHandoffs", find: "many", select: { id: true, createdAt: true, expiresAt: true, consumedAt: true }, orderBy: { createdAt: "desc" }, erase: "deleteMany" },
  { model: "webAuthnChallenge", key: "webAuthnChallenges", find: "many", select: { id: true, type: true, expiresAt: true, createdAt: true }, orderBy: { createdAt: "desc" }, erase: "deleteMany" },
  { model: "webAuthnCredential", key: "webAuthnCredentials", find: "many", select: { credentialId: true, publicKey: true, counter: true, createdAt: true }, orderBy: { createdAt: "desc" }, erase: "deleteMany" },
  { model: "deviceCredential", key: "deviceCredentials", find: "many", select: { label: true, deviceId: true, createdAt: true }, orderBy: { createdAt: "desc" }, erase: "deleteMany" },
  { model: "session", key: "sessions", find: "many", select: { id: true, expiresAt: true, userAgent: true, deviceLabel: true, deviceCredentialId: true, createdAt: true }, orderBy: { createdAt: "desc" }, erase: "deleteMany" },
  { model: "listeningHistory", key: "listeningHistory", find: "many", select: { id: true, mediaItemId: true, position: true, completed: true, lastPlayed: true, playedAt: true }, orderBy: { playedAt: "desc" }, erase: "deleteMany" },
  { model: "playSession", key: "playSessions", find: "many", select: { id: true, mediaItemId: true, startedAt: true, endedAt: true, fromPosition: true, toPosition: true, speed: true }, orderBy: { startedAt: "desc" }, erase: "deleteMany" },
  { model: "favourite", key: "favourites", find: "many", select: { mediaItemId: true, createdAt: true }, orderBy: { createdAt: "desc" }, erase: "deleteMany" },
  { model: "wishlistItem", key: "wishlistItems", find: "many", select: { id: true, title: true, author: true, seedMediaItemId: true, owned: true, createdAt: true }, orderBy: { createdAt: "desc" }, erase: "deleteMany" },
  { model: "profileLibraryEntry", key: "libraryEntries", find: "many", select: { mediaItemId: true }, orderBy: { mediaItemId: "asc" }, erase: "deleteMany" },
  // Everything held about the person except credential material (passwordHash).
  // Art. 15/20: the subject gets all of it, including sign-in metadata.
  { model: "profile", key: "profile", find: "unique", select: { id: true, name: true, color: true, role: true, createdAt: true, followsServerLibrary: true, ageBand: true, email: true, oauthProvider: true, oauthProviderId: true, disabled: true, lastLoginAt: true, lastActiveAt: true, passwordUpdatedAt: true, failedLoginCount: true, lockedUntil: true }, erase: "delete" },
]);

/** The delegate names, children-before-profile (deletion order). Derived. */
export const PROFILE_PERSONAL_DATA_MODELS: string[] = PERSONAL_DATA_ROWS.map((row) => row.model);

/** Inactive-profile retention: 24 months (approximated as 24 × 30 days). */
export const INACTIVE_PROFILE_RETENTION_MS = 24 * 30 * 24 * 60 * 60 * 1000;

export function inactiveProfileCutoff(now: Date): Date {
  return new Date(now.getTime() - INACTIVE_PROFILE_RETENTION_MS);
}

/** A delegate with the four methods the executors use. */
interface Delegate {
  findUnique(args: unknown): Promise<unknown>;
  findMany(args: unknown): Promise<unknown[]>;
  deleteMany(args: unknown): Promise<unknown>;
  delete(args: unknown): Promise<unknown>;
}

function delegateFor(prisma: PrismaClient, model: string): Delegate {
  const delegate = (prisma as unknown as Record<string, Delegate | undefined>)[model];
  if (!delegate) {
    throw new Error(`personal-data: no Prisma delegate for model "${model}"`);
  }
  return delegate;
}

/**
 * All personal data for one profile (GDPR Art. 15/20). Session-only secrets
 * (token hashes, password hashes) are never included — the selects simply
 * do not name them.
 */
export async function exportProfilePersonalData(prisma: PrismaClient, profileId: number) {
  const data: Record<string, unknown> = {};
  await Promise.all(
    PERSONAL_DATA_ROWS.map(async (row) => {
      const delegate = delegateFor(prisma, row.model);
      data[row.key] =
        row.find === "unique"
          ? await delegate.findUnique({ where: { id: profileId }, select: row.select })
          : await delegate.findMany({ where: { profileId }, select: row.select, orderBy: row.orderBy });
    }),
  );

  const profile = data.profile;
  if (!profile) return null;

  return {
    exportedAt: new Date().toISOString(),
    ...data,
  };
}

/** Erase every personal-data row owned by one profile (GDPR Art. 17). */
export async function eraseProfilePersonalData(prisma: PrismaClient, profileId: number): Promise<void> {
  await prisma.$transaction(
    PERSONAL_DATA_ROWS.map((row) => {
      const delegate = delegateFor(prisma, row.model);
      return row.erase === "delete"
        ? delegate.delete({ where: { id: profileId } })
        : delegate.deleteMany({ where: { profileId } });
    }) as never[],
  );
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
