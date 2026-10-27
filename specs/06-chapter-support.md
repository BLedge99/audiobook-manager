# Spec 06 — Chapter Support

## Purpose

M4B files embed chapter markers; multi-file MP3 books encode them as tracks.
The player must surface both uniformly.

The two shapes are different player problems, and the player handles them with
one model rather than two code paths: **the state is the listening position,
and the media source is derived from it.** See
[`decisions/017-player-state-is-position.md`](../decisions/017-player-state-is-position.md)
before changing any of this.

| Book | Segments the listener navigates | Media sources |
|---|---|---|
| multi-file MP3 set | one per file (a track) | one per track |
| single M4B / M4A / MP4 | one per embedded chapter (~70) | **one** — the whole file |

## Behaviour

- Chapter list renders under the player: title + start/end timestamps; current
  chapter highlighted.
- Tapping a chapter seeks to its start. For a chapter book this is a seek
  **inside the file already loaded** — the source does not change, nothing
  reloads, and playback continues. For a multi-file book it loads the
  corresponding track and seeks to the offset within it.
- **Advancing is a position change, not an event.** A chapter book plays from
  one chapter into the next inside one file; the highlight and the readout
  follow the clock. `ended` means the *book* ended. For a multi-file book
  `ended` means "load the next file", and it advances by exactly one track
  (taken from the file that was playing, not from the element's clock — at the
  end of track 1 the clock reads track 1's duration, which is where track 2
  starts).
- Seeking must never show a *decreasing* position. While a seek into a
  different file is in flight, the readout keeps showing the requested
  position rather than the outgoing file's clock.
- "End of chapter" sleep-timer option pauses at the end of the chapter the
  listener is in, recomputed when they seek.
- Chapter detection order: embedded M4B chapters → embedded ID3 CHAP frames →
  multi-file track list → filename heuristics (`Ch. 3`, `_03_`) as fallback.
  Chapters are only used when the book has at most one track: with more than
  one, chapter offsets are absolute times into one file and cannot describe the
  whole book.
- Chapter editing (stretch): rename/reorder chapters stored in app DB only —
  never written back into files. Could ship later without touching files.

## Data model

- `chapters` JSON on `MediaItem` (start, end, title) and ordered `Track`s for
  multi-file books; an optional `chapterOverrides` JSON for renames.
- A single-file book has exactly one `Track` (the file) **and** its chapters.
  The chapters are the segments; the track exists so the book can be
  downloaded, and is the local file every chapter plays from.

## Position ↔ source mapping

All of it is in `client/src/lib/position.ts` (segments) and
`client/src/lib/playback.ts` (mapping), both pure:

```ts
plan = planPosition(book, segments, kind, position)
// -> { segment, source, base, sourceTime }   sourceTime = position - base
```

`base` is 0 for a whole-book source (chapter offsets are already absolute file
times) and the segment's offset for a per-track source.

## Acceptance criteria

- [x] An M4B test fixture lists its chapters and seeks correctly.
- [x] A multi-MP3 book shows one row per file with track titles.
- [x] Sleep-timer "end of chapter" pauses at the boundary.
- [x] Current-chapter highlight updates during playback.
- [x] A chapter book advances when the clock crosses the boundary, without
      reloading the file and without an `ended` event.
- [x] A chapter pick does not change `audio.src`.
- [x] A multi-file book advances exactly one track on `ended`.
- [x] A cross-file seek never renders a position behind the requested one.
- [x] The media element is never given an empty source.
- [x] Tests: `lib/playback.test.ts` (mapping + round trip), `lib/position.test.ts`
      (parsing), `ChapterPlayer.test.tsx` (the behaviours above).
- [ ] `e2e/playback.spec.ts` — real playback (`currentTime` advances, pause
      sticks). Written but **not yet run**: the stack was down. Run it before
      calling this spec verified.

## Testing

- Vitest for chapter parsing/normalisation and for the position↔source mapping.
- Component tests drive `timeupdate` with a controlled `currentTime`; a fake
  `ended` is only ever used for a real end of file.
- One Playwright spec with real audio, because jsdom mocks `play()` and cannot
  prove that any bytes arrive.

## Not in this spec

- Audnexus chapter lookup, merging files into M4B (spec 13).
