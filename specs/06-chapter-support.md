# Spec 06 — Chapter Support

## Purpose

M4B files embed chapter markers; multi-file MP3 books encode them as tracks.
The player must surface both uniformly.

## Behaviour

- Chapter list renders under the player: title + start/end timestamps; current
  chapter highlighted.
- Tapping a chapter seeks to its start (for M4B: byte/time offset within the
  single file; for MP3 sets: switches to the corresponding track at 0).
- "End of chapter" sleep-timer option pauses at the next chapter boundary.
- Chapter detection order: embedded M4B chapters → embedded ID3 CHAP frames →
  multi-file track list → filename heuristics (`Ch. 3`, `_03_`) as fallback.
- Chapter editing (stretch): rename/reorder chapters stored in app DB only —
  never written back into files. Could ship later without touching files.

## Data model

- `chapters` JSON on `MediaItem` (start, end, title) and ordered `Track`s for
  multi-file books; an optional `chapterOverrides` JSON for renames.

## Acceptance criteria

- [ ] An M4B test fixture lists its chapters and seeks correctly.
- [ ] A multi-MP3 book shows one row per file with track titles.
- [ ] Sleep-timer "end of chapter" pauses at the boundary.
- [ ] Current-chapter highlight updates during playback.
- [ ] Tests: fixture parse test for M4B chapters; E2E chapter seek.

## Testing

- Vitest for chapter parsing/normalisation; Playwright seek assertions via
  audio currentTime.

## Not in this spec

- Audnexus chapter lookup, merging files into M4B (spec 13).
