# Spec 17 — Tag & taxonomy model

> **Status: implemented (2026-11).** The taxonomy tree, multi-narrator sets,
> series ordering, per-field overrides and both reset endpoints exist and are
> tested. Verified criterion-by-criterion against the code on 2026-11-17; the
> one remaining unchecked box names the gap (no reset-behaviour test).

## Purpose
Make the library genuinely taggable. Replace the single comma-separated
`genre` string with a curated multi-valued taxonomy, support **multiple
narrators**, series with reading order, publication facts, and per-field user
overrides that survive rescans without freezing unrelated fields.

Builds on ADR 009.

## Behaviour

- **Curated genre taxonomy.** A two-level `Genre` tree, seeded (~14 top-level,
  ~40 second-level) and fully editable. Provider genre strings map onto it via
  `GenreMapping(provider, rawValue, genreId)`. Unmapped strings fall through to
  a `Misc` bucket — never dropped.
- **Multi-valued genres** per book via `MediaItemGenre`, each tagged with its
  `source` (provider / user) so provenance survives.
- **Multiple narrators.** `Contributor` gains `translator` and `editor` roles
  and is keyed `(name, role)`. A book has many contributors of many roles.
  Contributor links are **reconciled** on every apply — stale rows from a
  previous match are removed, which the current code never does.
  Per-title readers (LibriVox sections) attach to the individual `Track`.
- **Series.** `Series(id, name)` plus `seriesName` / `seriesPosition` on
  `MediaItem`. `seriesPosition` is a float so `0.5`, `2.5` (insertions) sort
  correctly.
- **Publication facts.** `publisher`, `publishedYear`, `language`,
  `unabridged`, `isbn`.
- **Per-field precedence**, per ADR 009:
  `user override > enriched > embedded > filename`.
  Only fields listed in `FieldOverride` are protected from the scanner and
  from re-enrichment.
- **Reset.** `POST /api/audiobooks/:id/metadata/reset` clears overrides for one
  book; `POST /api/metadata/reset-all` clears them library-wide. Both restore
  embedded values and re-queue enrichment.
- **Custom tags** (the vocabulary) are managed in spec 18; this spec owns the
  reserved-word behaviour so genres and tags never collide in the UI.

## API deltas

- `GET /api/genres` — the taxonomy tree
- `GET/POST /api/genres`, `PATCH/DELETE /api/genres/:id` — manage the tree (as implemented; `PUT` was the original sketch, only `PATCH` exists)
- `GET/PUT /api/audiobooks/:id/tags` — full tag suite read/edit
- `POST /api/audiobooks/:id/metadata/reset`, `POST /api/metadata/reset-all`

## Acceptance criteria

- [x] A book carries several genres from the curated tree, each with a source.
- [x] A multi-narrator title lists every narrator; re-applying a match removes
      contributors that the new match does not have.
- [x] Series position sorts numerically, including fractional positions.
- [x] Fixing only a narrator does **not** freeze the title against rescans.
- [x] Rescan leaves a book with no overrides fully refreshed from embedded tags.
- [x] Reset restores embedded values and clears the override rows.
- [x] An unmapped provider genre lands in `Misc` rather than disappearing.
- [ ] Tests: precedence resolver (pure, table-driven) ✓, contributor
      reconciliation ✓, series sorting ✓ (client-side), reset behaviour ✗ (no
      test yet), taxonomy CRUD routes ✓.

## Not in this spec
Favourites and custom tag assignment (18), recommendations (19), UI (20).