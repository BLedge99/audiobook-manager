/**
 * ISBN helpers for buy links (spec 39, Phase 6.1).
 *
 * We only ever need: is this string an ISBN-13 (possibly hyphenated), is it an
 * ISBN-10, and what is its 13-digit form. No repairing of bad checksums — an
 * unreliable ISBN is worse than none, because a wrong ean= finds the wrong
 * book.
 */

/** Digits only, after stripping hyphens and spaces. */
function digits(raw: string): string {
  return raw.replace(/[\s-]+/g, "");
}

export function isValidIsbn13(raw: string | undefined | null): boolean {
  if (!raw) return false;
  const value = digits(raw);
  if (!/^97[89]\d{10}$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < value.length; i += 1) {
    sum += Number(value[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return sum % 10 === 0;
}

export function isValidIsbn10(raw: string | undefined | null): boolean {
  if (!raw) return false;
  const value = digits(raw).toUpperCase();
  if (!/^\d{9}[\dX]$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    sum += Number(value[i]) * (10 - i);
  }
  const check = value[9];
  sum += check === "X" ? 10 : Number(check);
  return sum % 11 === 0;
}

/** ISBN-10 → ISBN-13, or null when the source is invalid. */
export function isbn10To13(raw: string | undefined | null): string | null {
  if (!isValidIsbn10(raw)) return null;
  const body = digits(raw!).slice(0, 9);
  const core = `978${body}`;
  let sum = 0;
  for (let i = 0; i < core.length; i += 1) {
    sum += Number(core[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return `${core}${(10 - (sum % 10)) % 10}`;
}

/**
 * The one canonical ISBN-13 for any ISBN-ish input we are handed, or
 * undefined when it cannot be trusted. ISBN-10 is converted to 13 (the B&N
 * `ean=` and Libro.fm expect 13); hyphens/spaces are tolerated; anything
 * else is refused.
 */
export function normaliseIsbn(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const stripped = digits(raw);
  if (isValidIsbn13(stripped)) return stripped;
  const converted = isbn10To13(raw);
  return converted ?? undefined;
}
