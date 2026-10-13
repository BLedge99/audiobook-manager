import type { PrismaClient } from "@prisma/client";
import { coverFilename, fetchCover } from "./cover";
import { applyGenres, reconcileContributors, upsertSeries, type ContributorSpec } from "./taxonomy-service";
import { applyChapterTitles } from "./chapters";
import { normalizeText, type ProviderCandidate, type ProviderId } from "./types";

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
  item: {
    id: number;
    title: string;
    author: string;
    description: string | null;
    coverImagePath: string | null;
  },
  candidate: ProviderCandidate,
  options: {
    /** Field names a human has overridden; never written by enrichment. */
    overriddenFields?: Set<string>;
    /**
     * Cover to use when `candidate` has none (spec 23).
     *
     * Separate from `candidate` because the provider that matched the title is
     * frequently not the one that holds the artwork: LibriVox supplies no cover
     * field at all and Audnexus is ASIN-keyed, so the fallback is the only path
     * to artwork for a LibriVox recording. Only the *cover* is taken from it --
     * no other field is borrowed, so a lower-confidence match can never
     * overwrite a better one.
     */
    coverFallback?: { url: string; source: ProviderId; identifier?: string };
  } = {},
): Promise<ApplyResult> {
  const locked = options.overriddenFields ?? new Set<string>();
  const fields: string[] = [];
  const data: Record<string, unknown> = {};

  // ADR 009: enrichment never writes a field the user has set.
  const writable = (field: string) => !locked.has(field);

  if (candidate.title?.trim() && writable("title")) {
    data.title = candidate.title.trim();
    fields.push("title");
  }
  if (candidate.author?.trim() && writable("author")) {
    data.author = candidate.author.trim();
    fields.push("author");
  }
  if (candidate.narrators?.length && writable("narrator")) {
    data.narrator = candidate.narrators.join(", ");
    fields.push("narrator");
  }
  // Do not blank out an embedded description with a missing provider value.
  if (candidate.description && !item.description && writable("description")) {
    data.description = candidate.description;
    fields.push("description");
  }
  if (candidate.publishedYear && writable("publishedYear")) {
    data.publishedYear = candidate.publishedYear;
    data.releaseDate = new Date(Date.UTC(candidate.publishedYear, 0, 1));
    fields.push("publishedYear");
  }
  if (candidate.isbn && writable("isbn")) {
    data.isbn = candidate.isbn;
    fields.push("isbn");
  }
  if (candidate.publisher && writable("publisher")) {
    data.publisher = candidate.publisher;
    fields.push("publisher");
  }
  if (candidate.language && writable("language")) {
    data.language = candidate.language;
    fields.push("language");
  }

  // Series is normalised through the Series table so spelling variants group.
  if (candidate.seriesName && writable("seriesName")) {
    const seriesId = await upsertSeries(prisma, candidate.seriesName);
    if (seriesId !== null) {
      data.seriesId = seriesId;
      if (candidate.seriesPosition !== undefined && writable("seriesPosition")) {
        data.seriesPosition = candidate.seriesPosition;
      }
      fields.push("series");
    }
  }

  let coverImagePath: string | undefined;
  // Replace a cover only if we do not already have a local one; embedded art
  // is usually better than a provider thumbnail.
  //
  // Spec 23: prefer this candidate's own cover, else the fallback chosen by
  // `selectCoverSource`. The fallback contributes *only* the image -- no other
  // field is borrowed from it.
  const coverSource = candidate.coverUrl
    ? {
        url: candidate.coverUrl,
        source: candidate.source,
        identifier: candidate.providerKey ?? candidate.title.slice(0, 40),
      }
    : options.coverFallback;
  if (coverSource && !item.coverImagePath && writable("coverImagePath")) {
    const identifier = coverSource.identifier ?? candidate.title.slice(0, 40);
    const result = await fetchCover(coverSource.url, coverFilename(coverSource.source, identifier));
    if (result.ok && result.path) {
      coverImagePath = result.path;
      data.coverImagePath = result.path;
      fields.push("coverImagePath");
    }
  }

  // Genres and contributors are relational, not scalar columns.
  if (candidate.genres?.length) {
    await applyGenres(prisma, item.id, candidate.source, candidate.genres);
    fields.push("genres");
  }

  // Spec 21: official chapter titles, applied to the per-file tracks that the
  // player renders as chapters.
  if (candidate.chapters?.length) {
    const chapterCount = await applyChapterTitles(prisma, item.id, candidate.chapters);
    if (chapterCount > 0) fields.push("chapters");
  }
  if (candidate.narrators?.length || candidate.author) {
    const contributors: ContributorSpec[] = [];
    if (candidate.author) contributors.push({ name: candidate.author, role: "author" });
    for (const narrator of candidate.narrators ?? []) {
      contributors.push({ name: narrator, role: "narrator" });
    }
    await reconcileContributors(prisma, item.id, contributors);
    fields.push("contributors");
  }

  data.metadataSource = candidate.source;
  data.metadataConfidence = candidate.confidence;

  if (Object.keys(data).length > 0) {
    await prisma.mediaItem.update({ where: { id: item.id }, data });
  }

  return { applied: true, coverImagePath, fields };
}