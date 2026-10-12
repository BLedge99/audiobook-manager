# Spec 16 — Provider expansion & background enrichment

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
  - `AudnexusProvider` — `audnex.us/books`. Yields narrators, series +
    sequence, publisher, description, genres (parent + sub), ASIN, cover.
  - `GoogleBooksProvider`, `OpenLibraryProvider` — retained from spec 07,
    restricted to description/cover gap-filling.
- **Adaptive chain.** Provider priority is resolved per item from local
  evidence (LibriVox vs commercial) per ADR 008, then walked **sequentially,
  stopping at the first match at or above the confidence threshold**.
  `METADATA_PROVIDER_ORDER` overrides the resolution.
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

- `POST /api/enrichment/run` — enqueue a pass (optionally for one book)
- `GET /api/enrichment/status` — progress + counters
- `GET /api/audiobooks/:id/candidates` — now returns the widened shape
- `POST /api/audiobooks/:id/metadata` — unchanged contract, widened fields

## Acceptance criteria

- [ ] A LibriVox recording is enriched from LibriVox without calling Audnexus.
- [ ] A commercial-audiobook-shaped item tries Audnexus first.
- [ ] A match at/above threshold auto-applies; a match below it lands in the
      review queue and **does not** change the displayed title.
- [ ] Completing a scan automatically starts a pass; progress is visible and
      the run survives a server restart (resumable).
- [ ] One provider being unreachable never fails the item or the run.
- [ ] No writes to any file under a library root.
- [ ] `METADATA_PROVIDER_ORDER` forces a fixed order when set.
- [ ] Offline: the run reports failure per item and leaves metadata intact.
- [ ] Tests: each provider client with mocked HTTP, chain ordering + early
      stop, auto-apply threshold, resumable run, no-media-write assertion.

## Not in this spec
Tag taxonomy (17), favourites (18), recommendations (19), browse UI (20).