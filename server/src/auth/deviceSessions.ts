/**
 * Prune the sessions that predate device identity (spec 36).
 *
 * ## The bug this cleans up
 *
 * The Android app minted a **session row per sign-in**, so a phone that signed
 * in once a day filled the "Signed-in devices" panel with a row a day. The
 * fix stops new rows being made; this deals with the ones already there.
 *
 * ## Why a plan and not a delete
 *
 * Two things make a blind delete wrong:
 *
 *  - **A phone's live sign-in is one of those rows.** Revoking it signs the
 *    phone out, which is survivable but not what anyone asked for.
 *  - **Two identical phones share a user agent.** The agent names the model,
 *    not the handset, so "Pixel 4a" cannot tell two Pixel 4a's apart.
 *
 * So the plan works on the credential, which the server minted and can tell
 * apart, and it *adopts* the surviving legacy row into the credential instead
 * of throwing it away. The phone keeps working, ends up as one row, and its
 * next sign-in reuses the session it already had.
 *
 * The function is pure so the rules can be tested without a database.
 */

export interface DeviceSessionRow {
  id: string;
  profileId: number | null;
  userAgent: string | null;
  deviceCredentialId: string | null;
  lastUsedAt: Date;
}

export interface DeviceCredentialRow {
  id: string;
  profileId: number;
}

export interface PrunePlan {
  /** Session ids that stay live. */
  keep: string[];
  /** Session ids to revoke. */
  revoke: string[];
  /** Sessions to attach to a device credential, so the phone is one row. */
  link: { sessionId: string; credentialId: string }[];
}

function byNewest(rows: DeviceSessionRow[]): DeviceSessionRow[] {
  return [...rows].sort((a, b) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime());
}

export function planDeviceSessionPrune(
  sessions: DeviceSessionRow[],
  credentials: DeviceCredentialRow[],
): PrunePlan {
  const keep = new Set<string>();
  const revoke = new Set<string>();
  const link: { sessionId: string; credentialId: string }[] = [];

  const credentialsByProfile = new Map<number, DeviceCredentialRow[]>();
  for (const credential of credentials) {
    const list = credentialsByProfile.get(credential.profileId) ?? [];
    list.push(credential);
    credentialsByProfile.set(credential.profileId, list);
  }

  // 1. A credential owns one session. Rows that already carry the link are
  //    grouped by the credential, which is the only thing that tells two
  //    identical phones apart.
  const linked: DeviceSessionRow[] = [];
  const byCredential = new Map<string, DeviceSessionRow[]>();
  for (const session of sessions) {
    if (!session.deviceCredentialId) continue;
    linked.push(session);
    const list = byCredential.get(session.deviceCredentialId) ?? [];
    list.push(session);
    byCredential.set(session.deviceCredentialId, list);
  }
  for (const rows of byCredential.values()) {
    const [newest, ...rest] = byNewest(rows);
    keep.add(newest.id);
    for (const row of rest) revoke.add(row.id);
  }

  // 2. The rows that predate the link. They are grouped by the user agent,
  //    which is the best guess available for which phone they belong to.
  const legacy = sessions.filter((session) => !session.deviceCredentialId);
  const byAgent = new Map<string, DeviceSessionRow[]>();
  for (const session of legacy) {
    const key = `${session.profileId ?? 0}|${session.userAgent ?? ""}`;
    const list = byAgent.get(key) ?? [];
    list.push(session);
    byAgent.set(key, list);
  }
  for (const rows of byAgent.values()) {
    const [newest, ...rest] = byNewest(rows);
    const profileId = newest.profileId ?? 0;

    // If this phone already has a linked session, these rows are its older
    // ones: the phone is one row already, so they all go.
    const alreadyLinked = linked.some(
      (row) => row.profileId === profileId && row.userAgent === newest.userAgent,
    );
    if (alreadyLinked) {
      for (const row of rows) revoke.add(row.id);
      continue;
    }

    keep.add(newest.id);
    for (const row of rest) revoke.add(row.id);

    // Adopt the surviving row into the device's credential. With one
    // credential on the profile there is no ambiguity; with several there
    // might be, so the row is left alone and the operator is told.
    const profileCredentials = credentialsByProfile.get(profileId) ?? [];
    if (profileCredentials.length === 1) {
      link.push({ sessionId: newest.id, credentialId: profileCredentials[0].id });
    }
  }

  return { keep: [...keep], revoke: [...revoke], link };
}
