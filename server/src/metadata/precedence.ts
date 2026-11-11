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

/**
 * Which fields may the scanner write on rescan?
 *
 * Only the ones a human has NOT overridden. This is the fix for the spec 07
 * behaviour where correcting a narrator also froze the title forever.
 */
export function scannableFields(overriddenFields: Iterable<string>): Set<MetadataField> {
  const locked = new Set(overriddenFields);
  return new Set(METADATA_FIELDS.filter((field) => !locked.has(field)));
}

/** Which metadata fields a human has explicitly locked via overrides. */
export function lockedFields(overriddenFields: Iterable<string>): Set<string> {
  const locked = new Set<string>();
  for (const field of overriddenFields) {
    if ((METADATA_FIELDS as readonly string[]).includes(field)) {
      locked.add(field);
    }
  }
  return locked;
}

/** True when a user override protects this field from every writer. */
export function isFieldOverridden(field: string, overriddenFields: Iterable<string>): boolean {
  for (const overridden of overriddenFields) {
    if (overridden === field) return true;
  }
  return false;
}

/**
 * The scanner writes embedded-tag values. It may set a field only when no
 * human override protects it and no enriched value wins over it (ADR 028).
 */
export function canScannerWrite(
  field: string,
  overriddenFields: Iterable<string>,
  hasEnrichedLayer: boolean,
): boolean {
  return !isFieldOverridden(field, overriddenFields) && !hasEnrichedLayer;
}

/**
 * The enrichment applier writes enriched values. It may set or clear any field
 * that is not protected by a user override (ADR 028).
 */
export function canEnrichmentWrite(field: string, overriddenFields: Iterable<string>): boolean {
  return !isFieldOverridden(field, overriddenFields);
}

export type OverrideAction =
  | { action: "upsert"; value: string }
  | { action: "delete" }
  | { action: "noop" };

/**
 * Decide how to persist a user edit as a field override (ADR 009/028).
 *
 * - empty/whitespace/null/0: not a user-chosen value; remove an existing
 *   override so the scanner may fill the field, otherwise record nothing.
 * - unchanged from the previous value: no override write needed.
 * - otherwise: record the override.
 */
export function decideOverrideAction(
  _field: string,
  nextValue: unknown,
  previousValue?: unknown,
): OverrideAction {
  const isEmpty =
    nextValue === null ||
    nextValue === undefined ||
    (typeof nextValue === "string" && nextValue.trim() === "") ||
    nextValue === 0;
  const hadOverride = previousValue !== null && previousValue !== undefined && previousValue !== "";

  if (isEmpty) {
    return hadOverride ? { action: "delete" } : { action: "noop" };
  }

  const normalized =
    typeof nextValue === "string" ? nextValue.trim() : String(nextValue);
  if (previousValue !== null && previousValue !== undefined && String(previousValue) === String(nextValue)) {
    return { action: "noop" };
  }

  return { action: "upsert", value: normalized };
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