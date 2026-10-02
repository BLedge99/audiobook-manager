# Spec 07 — Metadata Enrichment

## Purpose

Embedded tags are often messy or missing. Enrichment fills in proper titles,
authors, descriptions, covers, and genres from online databases, with the user
in control.

## Behaviour

- For each `MediaItem`, generate candidate matches from Open Library and
  Google Books using title/author (from embedded tags or folder names).
- Store candidates with confidence scores in `MetadataCandidate`.
- UI: book detail → "Edit metadata" shows candidates; user picks one or enters
  a manual override. Confirmed choice lands on `MediaItem` and wins over future
  rescans (user overrides are authoritative).
- Covers: download the chosen cover into the app's covers directory (path
  sandboxed; see spec 11); never overwrite the user's media files.
- Descriptions trimmed to a sensible length for the UI; raw provider response
  kept in `MetadataCandidate.raw` for debugging.
- AI-assisted matching (optional, spec 12) can pre-rank candidates but never
  auto-applies without user confirmation.

## API deltas

- `POST /api/audiobooks/:id/enrich` — fetch candidates (async OK)
- `GET /api/audiobooks/:id/candidates`
- `POST /api/audiobooks/:id/metadata` — apply chosen/manual override

## Acceptance criteria

- [ ] With network available, candidates appear for a well-known LibriVox title.
- [ ] Confirming a candidate updates title/cover/description everywhere.
- [ ] User overrides survive subsequent library rescans.
- [ ] With network disabled, the UI degrades gracefully (error message, embedded data kept).
- [ ] No writes to media files; covers stored under app data dir only.
- [ ] Tests: provider client unit tests (mock HTTP), route tests for apply,
      E2E manual confirm flow.

## Not in this spec

- Audnexus integration (optional later), auto-embedding tags to files.
