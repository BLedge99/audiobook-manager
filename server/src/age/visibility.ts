import { maxAgeForBand } from "./bands";
import type { AgeContext } from "./policy";

/**
 * Spec 38 / ADR 033 — the Prisma `where` fragment for child visibility.
 *
 * Routes compose it with their own constraints via `andVisibility` instead
 * of writing the predicate an inline second time. `null` means "no extra
 * constraint" (non-children) so callers can splat it in unconditionally.
 *
 * Kept deliberately close to `policy.ts`: same order, same ladder, tested
 * against the same expectations. If the rule changes, both tests fail.
 */

export interface VisibilityWhere {
  AND: Array<Record<string, unknown>>;
}

export function visibilityWhere(
  caller: AgeContext,
  blockedGenreIds: ReadonlySet<number>,
): VisibilityWhere | null {
  if (caller.role !== "child") return null;
  const maxAge = maxAgeForBand(caller.ageBand);
  const and: Array<Record<string, unknown>> = [
    { OR: [{ minimumAge: null }, { minimumAge: { lte: maxAge } }] },
  ];
  if (blockedGenreIds.size > 0) {
    and.push({ NOT: { genres: { some: { genreId: { in: [...blockedGenreIds] } } } } });
  }
  return { AND: and };
}

export function andVisibility<T extends Record<string, unknown>>(
  base: T,
  visibility: VisibilityWhere | null,
): Record<string, unknown> {
  if (!visibility) return base;
  return { AND: [base, ...visibility.AND] };
}
