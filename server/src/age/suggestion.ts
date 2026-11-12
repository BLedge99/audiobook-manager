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

/** Subject strings and any `--`-qualified segments ("Wizards -- Juvenile fiction"). */
function ladderSegments(subjects: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of subjects) {
    for (const part of raw.split("--")) {
      const normalised = normalizeSubject(part);
      if (normalised) out.add(normalised);
    }
  }
  return [...out];
}

export function inferMinimumAgeFromSubjects(subjects: readonly string[] | null | undefined): number | null {
  if (!subjects || subjects.length === 0) return null;
  const segments = ladderSegments(subjects);
  for (const rule of SUBJECT_LADDER) {
    for (const subject of rule.subjects) {
      if (segments.includes(subject)) return rule.minimumAge;
    }
  }
  return null;
}

/**
 * Spec 38: the provider-derived suggestion for a candidate, or null when the
 * providers cannot tell us anything. Google Books' MATURE flag outranks the
 * category ladder; everything else falls back to the subject ladder (Open
 * Library's verbatim subjects when present, else the mapped genres).
 */
export function suggestionForCandidate(candidate: {
  source?: string;
  genres?: readonly string[];
  subjectStrings?: readonly string[];
  maturityRating?: string;
}): number | null {
  if (candidate.source === "googlebooks") {
    const fromMaturity = minimumAgeFromGoogleBooksMaturity(candidate.maturityRating);
    if (fromMaturity !== null) return fromMaturity;
  }
  return inferMinimumAgeFromSubjects(candidate.subjectStrings ?? candidate.genres ?? null);
}

export function minimumAgeFromGoogleBooksMaturity(
  maturityRating: string | null | undefined,
): number | null {
  return maturityRating === "MATURE" ? 16 : null;
}
