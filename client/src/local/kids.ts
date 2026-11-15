/**
 * The client-side counterpart of the server's `age/` module: the one place
 * that knows what a kids account may be shown.
 *
 * Spec 38 gives the server the visibility gate (shelf × blocklist × band).
 * This module owns the client's parallel question — "may this session see
 * buy surfaces?" — which the server enforces by never sending them to a
 * child, and the client must enforce by never rendering them.
 *
 * Fail-closed on the child role only, deliberately: unknown roles are NOT
 * children (the server owns visibility of unknown roles; this predicate
 * answers one question, it does not model the whole gate).
 */

export function isKidsAccount(role: string | null | undefined): boolean {
  return role === "child";
}

/** True for admin/member/unknown — false only for the child role. */
export function canSeeBuySurfaces(role: string | null | undefined): boolean {
  return !isKidsAccount(role);
}
