import { AudnexusProvider } from "./audnexus";
import { LibrivoxProvider } from "./librivox";
import { searchGoogleBooks, searchOpenLibrary } from "../enrichment";
import {
  PROVIDER_IDS,
  type EnrichmentQuery,
  type MetadataProvider,
  type ProviderCandidate,
  type ProviderId,
} from "./types";

/**
 * Spec 16 / ADR 008 — the adaptive provider chain.
 *
 * Audnexus and LibriVox fail in *disjoint* cases: Audnexus mirrors Audible's
 * commercial catalogue and has no entry for a LibriVox recording of a
 * public-domain title; LibriVox only knows what it produced. A fixed order
 * therefore wastes the first call on roughly half of any given library, so
 * priority is resolved per item from local evidence first.
 */

/** Threshold at which a candidate is good enough to stop walking the chain. */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.9;

export const UNKNOWN_AUTHOR = "Unknown author";

/**
 * Does this item look like a LibriVox / public-domain recording?
 *
 * Pure and exported for testing — it decides which provider is called first,
 * so it must be verifiable without a network call.
 */
export function looksLikeLibriVox(query: EnrichmentQuery): boolean {
  const haystack = [query.filePath, query.hintText, query.title]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (haystack.includes("librivox.org") || haystack.includes("librivox")) return true;
  if (haystack.includes("public domain") || haystack.includes("publicdomain")) return true;
  // LibriVox names releases like `12_creepytales_1206_librivox`, and the
  // scanner's multi-file titles come from the folder name.
  if (/\b\d+_[a-z0-9]+_\d+_/.test(haystack)) return true;
  return false;
}

/**
 * Resolve provider order for one item.
 *
 * `METADATA_PROVIDER_ORDER=librivox,audnexus` forces a fixed order and skips
 * detection entirely — the escape hatch if the heuristic misfires against a
 * real library (ADR 008).
 */
export function resolveProviderOrder(query: EnrichmentQuery): ProviderId[] {
  const override = process.env.METADATA_PROVIDER_ORDER?.trim();
  if (override) {
    const requested = override
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter((value): value is ProviderId => PROVIDER_IDS.includes(value as ProviderId));
    if (requested.length > 0) {
      // Append anything the operator omitted so no provider is unreachable.
      return [...requested, ...PROVIDER_IDS.filter((id) => !requested.includes(id))];
    }
  }

  // Audnexus is deliberately absent: it cannot search by title (ADR 011), so
  // including it would cost one guaranteed-404 request per book. It is used
  // separately as an ASIN-keyed lookup for chapter titles.
  return looksLikeLibriVox(query)
    ? ["librivox", "googlebooks", "openlibrary"]
    : ["googlebooks", "openlibrary", "librivox"];
}

/** Adapters over the two spec 07 clients so the chain treats all four alike. */
class GoogleBooksProvider implements MetadataProvider {
  id = "googlebooks" as const;
  // Book-oriented: no narrators, no series. Only fills description/cover gaps.
  supportsRichFields = false;
  async search(query: EnrichmentQuery): Promise<ProviderCandidate[]> {
    const results = await searchGoogleBooks(query.title, query.authorIsUnknown ? undefined : query.author);
    return results.map((result) => ({
      source: "googlebooks",
      title: result.title,
      author: result.author,
      coverUrl: result.coverUrl,
      description: result.description,
      confidence: result.confidence,
      raw: result.raw,
    }));
  }
}

class OpenLibraryProvider implements MetadataProvider {
  id = "openlibrary" as const;
  supportsRichFields = false;
  async search(query: EnrichmentQuery): Promise<ProviderCandidate[]> {
    const results = await searchOpenLibrary(query.title, query.authorIsUnknown ? undefined : query.author);
    return results.map((result) => ({
      source: "openlibrary",
      title: result.title,
      author: result.author,
      coverUrl: result.coverUrl,
      description: result.description,
      confidence: result.confidence,
      raw: result.raw,
    }));
  }
}

/**
 * Pick the candidate whose cover image should be downloaded.
 *
 * Returns the highest-confidence candidate that actually has a `coverUrl`, or
 * null when none does. Pure, so the "who supplies the artwork" decision is
 * testable without a database or a network.
 *
 * This exists because the provider that wins a title match often cannot supply
 * a cover at all: LibriVox's feed carries no cover-art field, and Audnexus has
 * been ASIN-keyed since ADR 011, so a LibriVox recording had no cover source
 * left in the chain. The cover is therefore chosen independently of which
 * candidate won -- the same reasoning spec 21 applies to chapter titles.
 *
 * Only called when the winner has no cover of its own; passing every candidate
 * through makes the rule self-contained and order-independent.
 */
export function selectCoverSource(
  candidates: ProviderCandidate[],
): { url: string; source: ProviderId; identifier?: string } | null {
  const withCover = candidates
    .filter((candidate) => Boolean(candidate.coverUrl))
    .sort((a, b) => b.confidence - a.confidence);
  const best = withCover[0];
  if (!best?.coverUrl) return null;
  return { url: best.coverUrl, source: best.source, identifier: best.providerKey };
}

export function createProviders(): Record<ProviderId, MetadataProvider> {
  return {
    librivox: new LibrivoxProvider(),
    audnexus: new AudnexusProvider(),
    googlebooks: new GoogleBooksProvider(),
    openlibrary: new OpenLibraryProvider(),
  };
}

export interface ChainResult {
  /** Best candidate found, or null if nothing cleared the bar. */
  best: ProviderCandidate | null;
  /** Every candidate seen, for the review queue and the spec 07 endpoints. */
  candidates: ProviderCandidate[];
  /** Which provider supplied `best`, or null. */
  provider: ProviderId | null;
  /** Ordered provider ids actually walked, for diagnostics. */
  walked: ProviderId[];
}

/**
 * Walk the chain sequentially, stopping at the first candidate at or above
 * `threshold` (spec 16). A provider that throws or is unreachable yields no
 * candidates and never fails the item.
 */
export async function runChain(
  query: EnrichmentQuery,
  options: {
    providers?: Record<ProviderId, MetadataProvider>;
    threshold?: number;
    /** Return everything seen instead of stopping early (review queue). */
    collectAll?: boolean;
  } = {},
): Promise<ChainResult> {
  const providers = options.providers ?? createProviders();
  const threshold = options.threshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const order = resolveProviderOrder(query);

  const candidates: ProviderCandidate[] = [];
  const walked: ProviderId[] = [];
  let best: ProviderCandidate | null = null;

  for (const id of order) {
    walked.push(id);
    const provider = providers[id];
    let results: ProviderCandidate[] = [];
    try {
      results = await provider.search(query);
    } catch {
      // Isolated failure: move to the next provider (spec 16 AC).
      continue;
    }
    for (const candidate of results) candidates.push(candidate);

    const providerBest = results[0];
    if (providerBest && (!best || providerBest.confidence > best.confidence)) {
      best = providerBest;
    }
    if (!options.collectAll && best && best.confidence >= threshold) break;
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  return {
    best,
    candidates,
    provider: best?.source ?? null,
    walked,
  };
}