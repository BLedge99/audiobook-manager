# Spec 01 — Scanner Consolidation

## Purpose

There are currently two scanner implementations: `server/src/scanner.ts`
(canonical, used by the server) and `server/src/services/scanner.ts` (older,
largely duplicated, divergent behaviour). This spec removes the duplication so
there is exactly one scanning code path.

## Behaviour

- A single scanner module owns: walking library roots, parsing files, grouping
  files into audiobooks, upserting `MediaItem`/`Track` rows, saving cover art,
  and updating `ScanState`.
- Multi-file books (a directory of chapter files) group into one `MediaItem`
  with ordered `Track`s; single-file M4B is one `MediaItem` with its own
  chapters JSON.
- Rescanning is idempotent: same input → same rows, no duplicate tracks or
  media items. Deleted files remove their rows.
- Progress is exposed via in-memory map + `ScanState` row.

## Tasks

- Delete or fully merge `server/src/services/scanner.ts` into the canonical
  scanner. Preserve any unique correct behaviour (e.g. chapter detection
  patterns) by porting them into the canonical module.
- Extract grouping/parsing/duration logic into pure, testable functions.

## Acceptance criteria

- [ ] `server/src/services/scanner.ts` no longer exists.
- [ ] One scanner module handles add/update/delete on rescan.
- [ ] Scanning the sample libraries in `test/` produces expected item/track counts.
- [ ] Fixture: a directory with 12 MP3s groups into one MediaItem with 12 tracks.
- [ ] A removed file disappears from the DB after rescan.
- [ ] Unit tests cover grouping, title fallbacks, and extension filtering.

## Manual checks

1. `make scan` on a root with test samples finishes with status `complete`.
2. Grid shows expected book count; rescan shows no duplicates.

## Testing

- Vitest unit tests for pure functions; integration scan test against a temp DB
  and `test/` fixture directories.

## Not in this spec

- Metadata enrichment (07), cover fetching from web (07), audio playback (05).
