# Spec 13 — Media Tools (Stretch)

## Purpose

Manual, explicit, reversible-in-spirit media file improvements. Defaults are
read-only; nothing here ever runs silently.

## Behaviour

- **Embed metadata:** apply a confirmed (spec 07) title/author/narrator/cover
  into the actual audio file, only after an explicit "Write to files" confirm.
  Create a timestamped backup copy first.
- **Merge to M4B:** combine a multi-file MP3 book into one M4B with chapters
  (FFmpeg), writing to a chosen output path — clearly a copy operation, originals kept.
- Every operation runs as a foreground action with progress and a result log;
  failures leave originals untouched.

## Acceptance criteria

- [ ] Embedding runs only on explicit confirm and produces a backup.
- [ ] Merge outputs a playable M4B with chapter markers.
- [ ] No other feature writes into the media volume.
- [ ] Tests: FFmpeg wrapper unit tests + a manual end-to-end on a copy.

## Not in this spec

- Transcoding/conversion libraries, cloud processing.
