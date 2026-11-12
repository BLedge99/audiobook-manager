/**
 * Spec 38 / ADR 033 — provider-derived minimum-age suggestions.
 *
 * These NEVER gate anything. They produce a `suggestedMinimumAge` the admin
 * may confirm (sets `minimumAge`) or dismiss in the admin panel. Unknown
 * signals produce no suggestion; downstream, a child-facing surface treats
 * "unknown" as "exclude".
 *
 * Google Books: only MATURE carries information (a NOT_MATURE volume may
 * still be an adult romance); it suggests 16. Anything else ⇒ no suggestion.
 *
 * Open Library: subjects mapped onto the 0/4/7/9/12/16 ladder, most specific
 * first ("first rule wins"). Normalised so provider slugs
 * ("picture-books", "young_adult_fiction") match.
 */

function normalizeSubject(subject: string): string {
  return subject
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SUBJECT_LADDER: ReadonlyArray<{ subjects: readonly string[]; minimumAge: number }> = [
  { subjects: ["picture books", "children's picture books"], minimumAge: 6 },
  { subjects: ["children's literature"], minimumAge: 9 },
  { subjects: ["juvenile fiction", "juvenile literature", "middle grade fiction"], minimumAge: 12 },
  { subjects: ["young adult fiction", "teen literature"], minimumAge: 13 },
];

export function inferMinimumAgeFromSubjects(subjects: readonly string[] | null | undefined): number | null {
  if (!subjects || subjects.length === 0) return null;
  const normalised = subjects.map(normalizeSubject);
  for (const rule of SUBJECT_LADDER) {
    for (const subject of rule.subjects) {
      if (normalised.includes(subject)) return rule.minimumAge;
    }
  }
  return null;
}

export function minimumAgeFromGoogleBooksMaturity(
  maturityRating: string | null | undefined,
): number | null {
  return maturityRating === "MATURE" ? 16 : null;
}
