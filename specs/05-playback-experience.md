# Spec 05 — Playback Experience Core

## Purpose

The finished app must feel like a first-class audiobook player on mobile
browsers, not a tech demo. This spec defines the core player UX end-to-end.

## Behaviour

- Audio streams via the existing `/api/audiobooks/:id/stream` and
  `/api/tracks/:id/stream` range-request endpoints.
- Controls: play/pause, seek 15s back/forward, seek bar, current/total time,
  playback speed (0.5x–3x in 0.25 steps), chapter list, sleep timer
  (15/30/60 min or "end of chapter"), mark complete.
- Multi-file books: "next track" advances to the next chapter/file and
  auto-plays; continuous playback across files without a page change.
- Sleep timer pauses playback and records progress.
- Resume remembers the last position (spec 04) and the selected speed.
- Media Session API: lock-screen/notification controls show title, cover,
  and play/pause/seek on Android Chrome.
- Errors: network hiccups show a retry banner, not a crash; ended state offers
  replay/next book.

## Acceptance criteria

- [ ] All controls work with touch on a phone-sized viewport.
- [ ] Speed change persists per profile.
- [ ] Sleep timer pauses and survives a page refresh (timer ends at absolute time).
- [ ] Next-track auto-advance works for multi-file books.
- [ ] Media Session shows metadata/controls on Android Chrome.
- [ ] Playwright E2E: play → seek → pause → resume → next chapter → complete.

## Testing

- Playwright full player flows; unit tests for speed/timer logic.

## Not in this spec

- Transcoding, offline downloads, casting.
