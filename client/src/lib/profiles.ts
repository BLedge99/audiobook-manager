/**
 * Spec 37, step 4.1 — the profile-resolution rules.
 *
 * Which profile's shelf the listener sees, and which one progress is saved
 * under, used to be computed in `App.tsx` with two ternaries that shared no
 * code and were covered by nothing. The rules themselves are the product, so
 * they now live here as a pure function the App calls.
 *
 * Two questions, two answers:
 *
 *  - the **shelf** profile: whose library is on screen. The session profile is
 *    authoritative when there is one; the stored hint is the break-glass
 *    fallback, used when the listener is not signed in to a profile.
 *  - the **player** profile: the one progress is saved under. In household
 *    mode it is the shelf profile; in demo mode it is the account itself, so a
 *    demo listener's progress is not scattered across per-session profiles.
 */

export type AccountExperience = "household" | "demo";

/** The session's profile, or null when there is none to resolve to. */
export interface ProfileContextInput {
  accountExperience: AccountExperience;
  sessionProfile: { id?: number } | null;
  /** The stored break-glass hint. */
  storedProfileId: string | null;
}

export interface ProfileContext {
  /** The profile whose shelf is shown. */
  activeProfileId: string | null;
  /** The profile progress is saved under. */
  playerProfileId: string | null;
}

export function resolveProfileContext(input: ProfileContextInput): ProfileContext {
  const sessionId = input.sessionProfile?.id ? String(input.sessionProfile.id) : null;
  const activeProfileId =
    input.accountExperience === "demo"
      ? sessionId
      : sessionId ?? input.storedProfileId;
  const playerProfileId =
    input.accountExperience === "demo"
      ? (input.sessionProfile ? "demo-account" : null)
      : activeProfileId;

  return { activeProfileId, playerProfileId };
}
