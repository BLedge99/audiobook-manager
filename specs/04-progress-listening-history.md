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
  updatedAt. Progress is only saved/restored for a selected profile;
  the player blocks playback (with an inline hint) when none is selected.
- Full listening history: each continuous listening session appends a row
  (profile, mediaItem, startedAt, endedAt, fromPosition, toPosition, speed).
  "Completed" is a derived flag also stored for quick filtering.
- On book detail load, the client fetches progress and resumes.
- Resume position clamps: negative → 0; beyond duration → 0 or offer "restart".
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

## Testing

- Vitest integration for API incl. edge positions; Playwright: play on one
  "device" context, resume in fresh context.

## Not in this spec

- Stats dashboards, recommendations using history (spec 12+).
