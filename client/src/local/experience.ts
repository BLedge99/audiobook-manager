/**
 * Is this the demo experience, or a real household server?
 *
 * One home for the literal (spec 42, phase 10). Every call site that used to
 * compare `accountExperience === "demo"` inline asks here instead.
 *
 * Fail-closed means the restricted surface: an unknown or missing experience
 * is NOT the demo — the household surface, profile-gated, is the default.
 * The parameter is `unknown` on purpose: the server's answer arrives as
 * JSON, and a garbage experience must not promote itself to the demo.
 */
export type AccountExperience = "household" | "demo";

export function isDemoExperience(experience: unknown): boolean {
  return experience === "demo";
}
