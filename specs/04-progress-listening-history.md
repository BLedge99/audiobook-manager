# Spec 04 — Server-Side Progress & Full Listening History

## Purpose

Listening state must survive device switches: a family member starts on a
laptop, resumes on a phone. The server is the source of truth.

## Behaviour

- While playing, the client reports playback position every N seconds
  (e.g. 10s) and on pause/ended via `PUT /api/audiobooks/:id/progress`.
  The periodic saver reads the latest position from a ref so its timer
  is not reset on every position tick.
- Stored per (profile, mediaItem): last position (seconds), completed flag,
  updatedAt. Exactly one row per (profile, mediaItem) is guaranteed by a
  database unique index; saves are upserts, so the periodic, pause and unmount
  savers cannot race each other into duplicate rows. Progress is only
  saved/restored for a selected profile; the player blocks playback (with an
  inline hint) when none is selected.
- Full listening history: each continuous listening session appends a row
  (profile, mediaItem, startedAt, endedAt, fromPosition, toPosition, speed).
  "Completed" is a derived flag also stored for quick filtering.
- On book detail load, the client fetches progress and resumes.
- Resume position clamps: negative → 0; beyond duration → clamped to the
  duration. `completed` is auto-derived only when the book's duration is
  known (otherwise every book with an unknown length would count as finished).
  Session rows are clamped the same way, and playback speed is capped at 10x.
- Books marked completed; replays allowed and create new history rows.

## API deltas

- `PUT /api/audiobooks/:id/progress` { position, completed?, speed? } (profile-scoped)
- `GET /api/audiobooks/:id/progress`
- `POST /api/history` { start, end, ... } or folded into progress updates
- `GET /api/history?profileId=` (optional, for stats later)

## Acceptance criteria

- [x] Position updates persist; reloading the page resumes at last position.
- [x] Switching device/browser with same profile resumes correctly.
- [x] Finishing a book sets completed=true; opening it again offers restart/0.
- [x] History rows exist for sessions; a session boundary = pause + gap > X.
- [x] Route tests cover clamping, idempotency, and profile isolation.
- [x] Concurrent saves keep a single resume row per (profile, mediaItem).
- [x] Resume survives switching books (E2E drives real playback, not just the
  API): seek to 3:00, play, open another book, reopen the first and press play
  — `e2e/resume-after-book-switch.spec.ts`.

## Testing

- Vitest integration for API incl. edge positions; Playwright: play on one
  "device" context, resume in fresh context.

## Not in this spec

- Stats dashboards, recommendations using history (spec 12+).
