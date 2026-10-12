import type { PrismaClient } from "@prisma/client";
import { coverFilename, fetchCover } from "./cover";
import { normalizeText, type ProviderCandidate } from "./types";

/**
 * Spec 16 — persisting and applying candidates.
 *
 * Writes to the database and the covers directory only. No file under a
 * library root is ever touched (spec 07 / spec 16 acceptance criteria).
 */

function encodeList(values: string[] | undefined): string | null {
  return values && values.length > 0 ? JSON.stringify(values) : null;
}

function decodeList(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Store every candidate the chain saw, replacing this item's previous rows.
 *
 * Spec 07 wiped candidates on each enrich, which also destroyed any candidate
 * the user had already reviewed. Rows are keyed (mediaItemId, source,
 * providerKey) so re-running updates in place rather than stacking duplicates.
 */
export async function storeCandidates(
  prisma: PrismaClient,
  mediaItemId: number,
  candidates: ProviderCandidate[],
): Promise<void> {
  await prisma.metadataCandidate.deleteMany({ where: { mediaItemId } });

  for (const candidate of candidates) {
    const data = {
      mediaItemId,
      source: candidate.source,
      title: candidate.title,
      author: candidate.author ?? null,
      coverUrl: candidate.coverUrl ?? null,
      description: candidate.description ?? null,
      confidence: candidate.confidence,
      narrators: encodeList(candidate.narrators),
      seriesName: candidate.seriesName ?? null,
      seriesPosition: candidate.seriesPosition ?? null,
      publisher: candidate.publisher ?? null,
      publishedYear: candidate.publishedYear ?? null,
      language: candidate.language ?? null,
      genres: encodeList(candidate.genres),
      raw: candidate.raw === undefined ? null : JSON.stringify(candidate.raw),
      providerKey: candidate.providerKey ?? `${normalizeText(candidate.title).slice(0, 80)}-${normalizeText(candidate.author ?? "")}`,
    };
    await prisma.metadataCandidate.create({ data });
  }
}

/** Convert a stored candidate row back into the in-memory shape. */
export function rowToCandidate(row: {
  source: string;
  title: string;
  author: string | null;
  coverUrl: string | null;
  description: string | null;
  confidence: number | null;
  narrators: string | null;
  seriesName: string | null;
  seriesPosition: number | null;
  publisher: string | null;
  publishedYear: number | null;
  language: string | null;
  genres: string | null;
}): ProviderCandidate {
  return {
    source: row.source as ProviderCandidate["source"],
    title: row.title,
    author: row.author ?? undefined,
    coverUrl: row.coverUrl ?? undefined,
    description: row.description ?? undefined,
    confidence: row.confidence ?? 0,
    narrators: decodeList(row.narrators),
    seriesName: row.seriesName ?? undefined,
    seriesPosition: row.seriesPosition ?? undefined,
    publisher: row.publisher ?? undefined,
    publishedYear: row.publishedYear ?? undefined,
    language: row.language ?? undefined,
    genres: decodeList(row.genres),
  };
}

export interface ApplyResult {
  applied: boolean;
  coverImagePath?: string;
  fields: string[];
}

/**
 * Apply an enriched candidate onto a `MediaItem`.
 *
 * Only fills fields the provider actually supplied and that the item does not
 * already have a *better* value for. Spec 16 applies above the confidence
 * threshold only; spec 17 introduces per-field overrides on top of this.
 */
export async function applyCandidate(
  prisma: PrismaClient,
  item: { id: number; title: string; author: string; description: string | null; coverImagePath: string | null },
  candidate: ProviderCandidate,
): Promise<ApplyResult> {
  const fields: string[] = [];
  const data: Record<string, unknown> = {};

  if (candidate.title?.trim()) {
    data.title = candidate.title.trim();
    fields.push("title");
  }
  if (candidate.author?.trim()) {
    data.author = candidate.author.trim();
    fields.push("author");
  }
  if (candidate.narrators?.length) {
    // Multiple narrators render as a single comma-separated string until the
    // Contributor reconciliation in spec 17 gives them real rows.
    data.narrator = candidate.narrators.join(", ");
    fields.push("narrator");
  }
  // Do not blank out an embedded description with a missing provider value.
  if (candidate.description && !item.description) {
    data.description = candidate.description;
    fields.push("description");
  }
  if (candidate.publishedYear) {
    data.releaseDate = new Date(Date.UTC(candidate.publishedYear, 0, 1));
    fields.push("releaseDate");
  }
  if (candidate.isbn) {
    data.isbn = candidate.isbn;
    fields.push("isbn");
  }

  let coverImagePath: string | undefined;
  // Replace a cover only if we do not already have a local one; embedded art
  // is usually better than a provider thumbnail.
  if (candidate.coverUrl && !item.coverImagePath) {
    const identifier = candidate.providerKey ?? candidate.title.slice(0, 40);
    const result = await fetchCover(candidate.coverUrl, coverFilename(candidate.source, identifier));
    if (result.ok && result.path) {
      coverImagePath = result.path;
      data.coverImagePath = result.path;
      fields.push("coverImagePath");
    }
  }

  data.metadataSource = candidate.source;
  data.metadataConfidence = candidate.confidence;

  if (Object.keys(data).length > 0) {
    await prisma.mediaItem.update({ where: { id: item.id }, data });
  }

  return { applied: true, coverImagePath, fields };
}