/**
 * Member eligibility for single-book metadata enrichment (spec 28, ADR 032).
 *
 * Central helper so the route handlers and tests agree on the rule.
 */

export const UNENRICHED_ELIGIBLE_STATUSES = [null, "pending", "review", "failed", "skipped", ""] as const;

/**
 * Is this book still eligible for a member-initiated lookup?
 *
 * Anything other than a successfully-applied enrichment counts as not yet
 * enriched and is eligible. `"applied"` is the one state that means an
 * operator/auto-match already put catalogue data on the book; a member must
 * not re-trigger or replace it. Unknown/unexpected statuses are treated as
 * "not applied" and therefore eligible — otherwise a typo in status could
 * lock the door forever.
 */
export function isUnenrichedForMemberLookup(enrichmentStatus: unknown): boolean {
  if (typeof enrichmentStatus !== "string") return enrichmentStatus == null; // null/undefined/omitted
  return enrichmentStatus !== "applied";
}

/**
 * May this caller perform the manual lookup now?
 * Admins always may. Members may only when the book is not yet
 * enrichment-applied. (Visibility checks are the caller's responsibility.)
 */
export function canTriggerMemberEnrich(
  role: "admin" | "member" | string | null | undefined,
  enrichmentStatus: unknown,
): boolean {
  if (role === "admin") return true;
  return isUnenrichedForMemberLookup(enrichmentStatus);
}
