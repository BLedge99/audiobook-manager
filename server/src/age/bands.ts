/**
 * Spec 38 / ADR 033 — the age-band ladder, written once.
 *
 * A child's age is stored as a band, never a date of birth (GDPR data
 * minimisation, Art. 5(1)(c)). The band maps to the highest book `minimumAge`
 * that child may see. Anything unrecognised fails closed to the strictest
 * ceiling — a corrupted or missing band must not widen access.
 */

export const AGE_BANDS = ["under-6", "6-9", "10-13", "14-17"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

export const MAX_AGE_BY_BAND: Record<AgeBand, number> = {
  "under-6": 5,
  "6-9": 9,
  "10-13": 13,
  "14-17": 17,
};

export const STRICTEST_MAX_AGE = 5;

export function isAgeBand(value: unknown): value is AgeBand {
  return typeof value === "string" && (AGE_BANDS as readonly string[]).includes(value);
}

export function maxAgeForBand(value: unknown): number {
  return isAgeBand(value) ? MAX_AGE_BY_BAND[value] : STRICTEST_MAX_AGE;
}
