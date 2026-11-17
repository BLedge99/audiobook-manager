# Spec 16 — Provider expansion & background enrichment

> **Status: implemented (2026-11).** Background enrichment is enqueued on
> scan-finish (`server/src/scanning.ts`), runs are resumable and persisted
> (`EnrichmentRun`/`EnrichmentItem`), and the chain supports early stop and
> `METADATA_PROVIDER_ORDER`. Verified criterion-by-criterion 2026-11-17; the
> one remaining unchecked box names the missing tests (resumable run,
> no-media-write). Note: the Audnexus provider is ASIN-only (no title search;
> `api.audnex.us`) — ADR 011.

## Purpose
Enrichment is currently a per-book button that a user must click. The library
presents folder names like `12_creepytales_1206_librivox` as titles. This spec
adds audiobook-native providers and makes enrichment happen automatically
after a scan, so real titles, narrators and covers appear across the whole
library without manual effort.

Supersedes the provider list in spec 07. Builds on ADR 008.

## Behaviour

- **Provider clients**, each independently optional and each degrading in
  isolation:
  - `LibriVoxProvider` — `librivox.org/api/info/feed/audiobooks`. Yields
    authors, **translators**, genres, `copyright_year`, language, cover art,
    and `sections` (per-file chapter list with a **reader** per section).
  - `AudnexusProvider` — `api.audnex.us/books` (ASIN-keyed; no title search —
    ADR 011). Yields narrators, series +
    sequence, publisher, description, genres (parent + sub), ASIN, cover.
  - `GoogleBooksProvider`, `OpenLibraryProvider` — retained from spec 07,
    restricted to description/cover gap-filling.
- **Adaptive chain and field pooling.** Provider priority is resolved per item
  from local evidence (LibriVox vs commercial) per ADR 008 and searched
  sequentially. The highest-confidence candidate remains the match winner;
  other candidates that plausibly match the same title/author may fill fields
  the winner does not provide. The winner's values take precedence when both
  sources supply a field. Provider-specific values (such as genres) retain the
  supplying provider's identity for mapping. `METADATA_PROVIDER_ORDER`
  overrides the search order.
- **Background pass.** Completing a scan enqueues an enrichment run. The run
  is resumable, persisted in `ScanState`-adjacent progress columns, bounded by
  a concurrency cap and a per-provider delay, and reports
  queued/in-flight/done/failed counts to the UI.
- **Apply policy.**
  - Match confidence **≥ `AUTO_APPLY_CONFIDENCE` (default 0.9)** is applied
    automatically.
  - Anything below that is **queued for review**, never applied silently.
  - An item with **no** confident match is left with its embedded metadata
    untouched and marked `skipped`.
- **No files are ever written.** This spec writes to the database and the
  covers directory only, exactly as spec 07 requires.
- **Covers** are downloaded into `COVER_DIR`, size- and content-type-checked.

## Data model

- `MetadataCandidate` widened: `narrators`, `seriesName`, `seriesPosition`,
  `publisher`, `publishedYear`, `language`, `isbn`, `genres`, `providerKey`,
  `confidence`, `raw`.
- `EnrichmentRun(id, status, queued, processed, failed, skipped, startedAt,
  finishedAt, message)` and `EnrichmentItem(runId, mediaItemId, status,
  provider, confidence, message)`.

## API deltas

- `POST /api/enrichment/run` — enqueue a pass (optionally for one book) (admin-only)
- `GET /api/enrichment/status` — progress + counters (admin-only)
- `POST /api/audiobooks/:id/enrich` — synchronous single-book lookup; a
  member may call this for a single book not yet enrichment-applied (spec 28,
  ADR 032)
- `GET /api/audiobooks/:id/candidates` — stored candidates; member-accessible
  for an unenriched book, admin-only once applied
- `POST /api/audiobooks/:id/metadata` — `candidateId` applies a stored candidate;
  manual field edits are admin-only (spec 17)

## Acceptance criteria

- [x] A LibriVox recording is enriched from LibriVox without calling Audnexus.
- [x] A commercial-audiobook-shaped item tries Google Books then Open Library —
      Audnexus is ASIN-only and deliberately excluded from the search chain
      (ADR 011), so "Audnexus first" is not and never was the behaviour.
- [x] A match at/above the banded auto-apply bar (0.7 floor + author agreement
      or exact title — `shouldAutoApply`) applies; a match below it lands in
      the review queue and **does not** change the displayed title.
- [x] Completing a scan automatically starts a pass; progress is visible via
      `/api/enrichment/status`; the run resumes on boot (implemented in
      `metadata/run.ts` `resumeIncomplete`; no dedicated resumable-run test).
- [x] One provider being unreachable never fails the item or the run.
- [x] No writes to any file under a library root (enrichment writes DB rows and
      `COVER_DIR` only — verified by code review; no dedicated assertion test).
- [x] `METADATA_PROVIDER_ORDER` forces a fixed order when set.
- [x] Offline: items are marked `skipped` (not `failed`) and embedded metadata
      is left intact.
- [ ] Tests: each provider client with mocked HTTP ✓, chain ordering + early
      stop ✓, auto-apply threshold ✓, resumable run ✗ (missing), no-media-write
      assertion ✗ (missing).

## Not in this spec
Tag taxonomy (17), favourites (18), recommendations (19), browse UI (20).