/**
 * Spec 17 / ADR 009 — per-field metadata precedence.
 *
 * `user override > enriched > embedded > filename`
 *
 * Pure and dependency-free so the precedence rules can be table-tested without
 * a database. Everything here is a total function of its inputs.
 */

/** Fields that participate in precedence. */
export const METADATA_FIELDS = [
  "title",
  "subtitle",
  "author",
  "narrator",
  "description",
  "seriesName",
  "seriesPosition",
  "publisher",
  "publishedYear",
  "language",
  "isbn",
  "coverImagePath",
] as const;

export type MetadataField = (typeof METADATA_FIELDS)[number];

export type FieldSource = "override" | "enriched" | "embedded" | "derived";

export interface FieldLayer {
  override?: string | null;
  enriched?: string | null;
  embedded?: string | null;
  derived?: string | null;
}

export interface ResolvedField {
  field: MetadataField;
  value: string | null;
  source: FieldSource | null;
  /** True when a human set this value, so the scanner must not clobber it. */
  isOverridden: boolean;
}

const PRECEDENCE: FieldSource[] = ["override", "enriched", "embedded", "derived"];

function isEmpty(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === "";
}

/**
 * Resolve one field across its layers.
 *
 * An empty string counts as absent at every layer, so a provider that returns
 * `"  "` cannot blank out an embedded value.
 */
export function resolveField(field: MetadataField, layers: FieldLayer): ResolvedField {
  for (const source of PRECEDENCE) {
    const value = layers[source];
    if (!isEmpty(value)) {
      return {
        field,
        value: (value as string).trim(),
        source,
        isOverridden: source === "override",
      };
    }
  }
  return { field, value: null, source: null, isOverridden: false };
}

export function resolveFields(layers: Record<string, FieldLayer>): Partial<Record<MetadataField, ResolvedField>> {
  const out: Partial<Record<MetadataField, ResolvedField>> = {};
  for (const field of METADATA_FIELDS) {
    out[field] = resolveField(field, layers[field] ?? {});
  }
  return out;
}

export const SCANNER_LEGACY_FIELDS = [
  "title",
  "author",
  "narrator",
  "releaseDate",
  "genre",
  "coverImagePath",
] as const;

/**
 * Derives whether a field is writable during a rescan, adhering to ADR 009.
 *
 * Spec 17 / ADR 009: per-field overrides replace the spec 07 all-or-nothing
 * `metadataSource === "user"` sentinel. Fixing only a narrator must no
 * longer freeze the title against rescans.
 *
 * Only the spec 07 `user` sentinel gets the blanket legacy lock, and
 * only when no per-field overrides exist (those rows predate spec 17).
 * `manual` is deliberately NOT locked wholesale: it is written by the
 * spec 16/17 routes, which record real per-field overrides for what
 * the user actually set. Blanket-freezing on `manual` silently and
 * permanently blocked the scanner from ever correcting a title.
 */
export function scannerLockedFields(
  overriddenFields: Iterable<string>,
  metadataSource?: string | null,
): Set<string> {
  const overrides = Array.from(overriddenFields);
  const legacyLock = metadataSource === "user" && overrides.length === 0;
  const locked = new Set<string>(overrides);
  if (legacyLock) {
    for (const field of SCANNER_LEGACY_FIELDS) {
      locked.add(field);
    }
  }
  return locked;
}

/**
 * Which fields may the scanner write on rescan?
 *
 * Only the ones a human has NOT overridden. This is the fix for the spec 07
 * behaviour where correcting a narrator also froze the title forever.
 */
export function scannableFields(
  overriddenFields: Iterable<string>,
  metadataSource?: string | null,
): Set<MetadataField> {
  const locked = scannerLockedFields(overriddenFields, metadataSource);
  return new Set(METADATA_FIELDS.filter((field) => !locked.has(field)));
}

/** Convert a resolved field set into a Prisma-shaped update payload. */
export function toPrismaData(resolved: Partial<Record<MetadataField, ResolvedField>>): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  const setString = (column: string, field: MetadataField) => {
    const entry = resolved[field];
    if (entry) data[column] = entry.value;
  };

  setString("title", "title");
  setString("subtitle", "subtitle");
  setString("author", "author");
  setString("narrator", "narrator");
  setString("description", "description");
  setString("publisher", "publisher");
  setString("isbn", "isbn");
  setString("language", "language");
  setString("coverImagePath", "coverImagePath");

  if (resolved.seriesPosition?.value !== undefined && resolved.seriesPosition?.value !== null) {
    const parsed = Number(resolved.seriesPosition.value);
    if (Number.isFinite(parsed)) data.seriesPosition = parsed;
  }
  if (resolved.publishedYear?.value !== undefined && resolved.publishedYear?.value !== null) {
    const parsed = Number.parseInt(resolved.publishedYear.value, 10);
    if (Number.isFinite(parsed)) data.publishedYear = parsed;
  }
  if (resolved.seriesName?.value !== undefined && resolved.seriesName?.value !== null) {
    data.seriesNameRaw = resolved.seriesName.value;
  }

  return data;
}