# ADR 017 — The player's state is the listening position, not the media source

## Status

Accepted (2026-10-27). Supersedes the "the player advances by changing its
source URL" model that `ChapterPlayer` had carried since `ad4dbee`.

Implemented by [`specs/06-chapter-support.md`](../specs/06-chapter-support.md)
and `client/src/lib/playback.ts` + `client/src/lib/usePlayerSource.ts`.

## Context

An audiobook is one of two shapes, and they are not the same player problem:

| Shape | Segments the listener navigates | Files that exist |
|---|---|---|
| Multi-file MP3 set | one per file (track) | one per track |
| Single M4B with embedded chapters | one per chapter (~70) | **one** |

The original player treated "which media source is loaded" as its state. A
track change was a URL change, and one effect keyed on that URL set `src`,
called `load()` and played. For the MP3 shape that is exactly right, and it is
why auto-advance worked.

Then chapters were added. For an M4B, all seventy chapters share one URL. That
silently invalidated the mechanism the player was built on:

- `onEnded` set `index + 1`. The URL did not change, so the effect never
  re-fired and nothing happened. **Chapters never advanced.**
- `ended` on a one-file book fires at the end of the *file*, when the position
  is already in the last chapter. So the later "fix" that made `onEnded` seek
  to the next chapter and play was **unreachable in real use** — it only ever
  executed the "book finished" branch. Its regression tests passed because they
  dispatched `ended` with the index still at chapter 1, a state a real element
  cannot be in.
- Worse, an M4B had no `Track` rows until `a97b344` (they are created for
  downloads), so the client had two different notions of "chapter book"
  (`tracks.length === 0 && chapters.length > 0`, then `chapters.length > 0`)
  and the wrong one in each of several places.

Each attempt to make the one-file case work inside the source-URL model added
another special case: `pendingSeekRef`, `desiredTimeRef`,
`desiredTimeLockedRef`, `activeSrcRef`, `switchingSourceRef`, plus
`if (isChapterBook)` branches in five functions and `setCurrentTime(0)` on
every source swap -- the last of which is why the playhead visibly jumped to
the start before landing on the requested point.

The final state was a player that did not start at all on Android. Two
guards, added to fix unrelated things, each independently prevented a source
from ever reaching the element:

- `const streamUrl = ... : isNativeShell() ? "" : apiUrl(remoteUrl)`, combined
  with `if (!streamUrl) return` — in the shell nothing loads until a
  media-token round-trip completes, and if it fails, nothing loads at all.
- `localTrackIdRef.current = trackId` set *before* the local URL was resolved,
  plus `localUrlForTrack` returning `undefined` for both "not downloaded" and
  "the replica is still loading". Opening a book promptly after launch
  memoised "no local file" for the life of the player.

## Decision

**The player's state is the listening position, in book seconds. The media
source and the time within it are derived from it, by a pure function.**

```
plan = planPosition(book, segments, kind, position)
// { segment, source, base, sourceTime }   where sourceTime = position - base
```

- `base` is 0 for a whole-book source (chapter offsets are already absolute
  file times) and the segment's offset for a per-track source. That one
  subtraction is the whole mapping.
- A seek **inside the media that is already loaded** is a `currentTime` write.
  A seek **into different media** is a position change; the loader re-applies
  the same position once the new file has metadata. One `pending` position
  replaces the five overlapping refs.
- **Advance is a position change, not an event.** A chapter boundary is
  crossed by the clock, not by a URL change, and a chapter book plays through
  it with no reload. `ended` therefore means "the book finished" for a
  whole-book source, and "load the next file" for a track source.
- The displayed position is `pending ?? position`, so the readout follows what
  the listener asked for until the element has actually reached it. This is
  what removes the rewind flash.
- **A source can never be empty.** Resolution is local file → media-token
  stream → plain stream URL, in one place. A token is an optimisation; it is
  not allowed to make the book unplayable.

## Alternatives considered

- **Keep the source-URL model and patch `onEnded` harder.** Rejected: the
  mechanic it depends on (a URL change per segment) does not exist for the
  shape that is most commercial audiobooks. It also cannot be tested honestly,
  which is why an unreachable branch shipped with green tests.
- **Give each chapter its own source URL** (`#t=` fragments, or a server route
  that seeks before streaming). Rejected: media fragments are not respected by
  the Android WebView player, and a per-chapter stream route creates a
  separate HTTP range negotiation per chapter boundary — a gap in playback at
  every chapter, on a phone, over WiFi.
- **Seek without reloading by keeping the old pending-seek refs and adding a
  couple more guards.** Rejected: that is the current state, and the failure
  modes are emergent. Five refs with overlapping meanings cannot be reasoned
  about, only patched.
- **Let `onEnded` drive chapter advance anyway**, by seeking `currentTime` when
  the element reports `ended` early. Rejected: an element only reports `ended`
  at the end of its media; asking it to act as a chapter-boundary detector
  means comparing against segment maths it does not have. The clock already
  tells us where we are.

## Consequences

- The player is ~600 lines instead of ~850, and has one transport function
  (`goTo`) instead of a `if (isChapterBook)` branch in five places.
- The mapping is pure and unit-tested against every second of both book
  shapes, including the round trip `position → (base, sourceTime) → position`.
  Regressions here now fail a fast test rather than an album.
- Two invariants must be preserved by anyone editing it: **the displayed
  position never goes backwards during a seek**, and **the source is never an
  empty string**. Both have regression tests; both were real bugs.
- `ended` no longer means "advance" for a chapter book, so the chapter list can
  no longer be driven by it. Nothing else depended on that.
- The `Track` rows added in `a97b344` stay: they are what makes a one-file
  book downloadable, and `sourceForSegment` uses the book's first track as the
  local file for every chapter of it.
- Remaining risk: the seek path is only provable with a real media element.
  `e2e/playback.spec.ts` exists for that and must be run against the stack.
