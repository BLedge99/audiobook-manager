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

- [x] With network available, candidates appear for a well-known LibriVox title.
- [x] Confirming a candidate updates title/cover/description everywhere.
- [x] User overrides survive subsequent library rescans.
- [x] With network disabled, the UI degrades gracefully (error message, embedded data kept).
- [x] No writes to media files; covers stored under app data dir only.
- [ ] Tests: provider client unit tests (mock HTTP), route tests for apply,
      E2E manual confirm flow. *(provider clients only; route + E2E missing)*

## Status (audit 2026-10-12)

Scored as **partially delivered**. The ticked boxes cover behaviour that exists,
but the spec is not fully met:

- **No manual override form exists in the UI.** `POST /api/audiobooks/:id/metadata`
  accepts manual `title`/`author`/`description`/`coverUrl`, but `MetadataEditor`
  renders only a candidate list. The "user picks one **or enters a manual
  override**" requirement is unmet at the client.
- **Confidence is never shown**, and candidates have no cover thumbnails or
  description preview.
- **No route tests** exist for `POST /enrich`, `GET /candidates` or
  `POST /metadata` — only the four provider-client tests in `enrichment.test.ts`.
- **No test** covers "user overrides survive rescans" — the most important
  scanner/enrichment interaction is untested.
- **Description trimming** is not implemented.
- **No metadata route has a Fastify schema**, violating spec 11.
- **Absolute server paths leak** in `GET /api/audiobooks`, `GET /api/audiobooks/:id`
  and the `POST /metadata` response (`filePath`, `coverImagePath`).

Remediation is folded into specs 16–20: providers are replaced by 16, the
override mechanism by 17 (ADR 009), and the review-queue UI by 20. Until those
land, treat "no manual override" and "no route tests" as open.

## Not in this spec

- Audnexus integration (optional later), auto-embedding tags to files.
