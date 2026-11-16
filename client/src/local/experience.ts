/**
 * Is this the demo experience, or a real household server?
 *
 * One home for the literal (spec 42, phase 10). Every call site that used to
 * compare `accountExperience === "demo"` inline asks here instead.
 *
 * Fail-closed means the restricted surface: an unknown or missing experience
 * is NOT the demo — the household surface, profile-gated, is the default.
 */
export type AccountExperience = "household" | "demo";

export function isDemoExperience(experience: AccountExperience | null | undefined): boolean {
  return experience === "demo";
}
