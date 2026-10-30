# Spec 14 — Listening Position Display

## Purpose

The server already remembers where each profile stopped listening (spec 04), but
the interface barely shows it. The player has a single progress bar spanning the
whole book with a `m:ss` counter, so "Chapter 4, 45 minutes in" and "38% of the
book" have to be inferred by arithmetic. The library grid shows nothing at all.

The listener should be able to answer, at a glance and without doing maths:
*where am I in this chapter, how far through the book am I, and how long is
left?*

## Research basis

The pattern below is the convergent one across mature audiobook players, checked
against Libby, Sora/OverDrive, Audible, Apple Books and Audiobookshelf:

1. **Book-level and chapter-level progress shown together, not instead of each
   other.** Audible and Audiobookshelf's Android app both do this; Libby puts
   overall percentage + time remaining at the top of the player and elapsed/remaining
   in the current chapter on either side of the chapter name. Audiobookshelf's
   *web* player only offers one bar at a time and has an open request for both
   (advplyr/audiobookshelf#5440) — so the dual bar is the differentiator.
2. **Chapter boundaries drawn on the timeline.** Libby: "the timeline shows your
   progress, chapter breaks, your bookmarks, and your highlights."
3. **A marker at the position where this listening session began.** Apple Books
   draws "the point where you started listening ... marked with a gray circle on
   the timeline". Directly relevant here given the resume bugs in spec 04.
4. **Do not rebuild the slider.** Multiple accessibility sources converge: keep
   the native `<input type="range">` so keyboard and screen-reader support are
   inherited, and layer the ticks/markers as `aria-hidden` decoration. Canvas
   is called out as inaccessible and is unnecessary here (tens of ticks, not
   thousands).

## Behaviour

### Freshness (this is the part that is easy to get wrong)

- The library's `progress` values are only as fresh as the last
  `GET /api/audiobooks`. Listening in the player must be enough to update the
  shelf: when the player finishes saving on unmount it signals the shell, which
  refetches. Refetching *after* the write resolves matters — the final save is a
  fire-and-forget `keepalive` request, so a refetch fired on a guessed delay
  races it and re-reads the old position.
- Background refetches must be **silent**: they must not flip `loading`, or the
  whole shelf is replaced by "Loading library..." to update one progress bar.
- The same staleness applies across devices, so the shell also refetches on
  window focus and on `visibilitychange` → visible.

### Player (`ChapterPlayer`)

- A readout line above the timeline showing, for the current position:
  - Chapter index and title (or `Track n` / `Chapter n` fallback).
  - Elapsed within the current chapter, and the chapter's total duration.
  - Percentage complete, and time remaining, for the whole book.
- Two progress tracks, always both visible:
  - **Book bar** — the existing seek control, spanning the whole book, with a
    tick at every chapter start.
  - **Chapter bar** — a thinner, non-interactive track showing progress through
    the current chapter only.
- A "you started here" marker on the book bar at the position the current
  listening session began. Hidden when there is no meaningful marker (fresh
  book, or the session start is within 10s of the playhead).
- Ticks are inert decoration, not click targets: clicking the track keeps the
  native proportional seek, and chapter jumps stay on the chapter list and the
  previous/next buttons, which are properly focusable (decisions/007).
- Single-segment books (one file, no chapters) collapse to one chapter and the
  chapter bar is omitted rather than duplicating the book bar.

### Library grid

- `/api/audiobooks` gains a profile-scoped `progress` field so the grid can show
  saved position without N+1 requests.
- A **Continue listening** section above the full grid, listing books with saved
  progress, most recently played first.
- Each card shows a progress bar with percentage and time left; cards in the main
  grid below also carry a thin progress bar when the book is part-finished.

## API deltas

- `GET /api/audiobooks` — each item gains optional
  `progress: { position, completed, lastPlayed } | null`, scoped to the
  `x-profile-id` header. Absent/invalid profile → `progress: null` on every
  item, **not** a 400: the library must still render before a profile is picked.

## Component boundaries

All position maths moves out of `ChapterPlayer` into a pure, unit-tested module
so the GUI redesign (spec 15) restyles rather than rebuilds:

- `client/src/lib/position.ts` — `parseSegments`, `describePosition`,
    `chapterTicks`, `timeLabel`, `remainingLabel`, `percentComplete`.
- `client/src/components/ProgressTimeline.tsx` — the native range input plus
    `aria-hidden` overlay for ticks/markers, and the chapter sub-bar. Owns no
    position logic.

## Acceptance criteria

- [x] Player shows "Chapter N" + title + elapsed-in-chapter for the current
      position, and it updates as playback crosses a chapter boundary.
- [x] Book and chapter progress are both visible at once.
- [x] Chapter ticks render on the book timeline at the correct offsets, and the
      count matches the segment count (first tick is the track origin and is not
      drawn).
- [x] The readout is not an `aria-live` region, so per-second position changes
      do not spam a screen reader.
- [x] Session-start marker renders at the position the session began.
- [x] Single-segment books show no duplicate chapter bar.
- [x] Grid shows a Continue listening section ordered by `lastPlayed` desc.
- [x] `/api/audiobooks` returns profile-scoped `progress`; another profile's
      progress is never leaked.
- [x] `position.ts` has unit tests for boundaries: position 0, exactly on a
      chapter start, last second of a chapter, past the final chapter, NaN,
      negative and `+Infinity` input.
- [x] The timeline is still keyboard operable and keeps
      `aria-label="Audiobook progress"`.
- [x] Closing the player updates the library's progress bars without a reload or
      the refresh button, and without showing the loading placeholder.
- [x] Known consequence: a part-finished book's title is rendered as a heading
      twice (once in "Continue listening", once in "All audiobooks"). Both are
      legitimate, so any heading-based locator must be scoped — an unscoped
      `getByRole("heading", { name: title })` is a strict-mode violation.

## Testing

- Vitest (client): `position.ts` pure-function tests, including every boundary
  case above, plus a `ProgressTimeline` render test asserting tick count and
  marker position.
- Vitest (server): `/api/audiobooks` returns `progress: null` without a profile,
  the correct row with one, and never another profile's row.
- Playwright: open a known book and assert the readout text and the chapter bar;
  assert the Continue listening section appears after progress is saved.

## Not in this spec

- Visual polish, colours, tick hover tooltips, waveform rendering — spec 15.
- Bookmarks and highlights on the timeline (research shows them, but they are a
  new data model and a separate feature).
- Drag-to-scrub with a floating time tooltip.
