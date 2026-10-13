# Spec 21 — Official chapter titles

## Purpose
The library fetches book titles from providers but leaves chapter names as
whatever the file's embedded tags happened to say. Those are frequently
useless (`"Section 01"`) or redundant with the track number already rendered
beside them (`"01 - THE TELL-TALE HEART"` → "Track 7 - 07 - THE TELL-TALE
HEART"). Chapters should use the official names where they are retrievable.

## Behaviour

- **Embedded chapter data first.** M4B/M4A chapter atoms (spec 06) are
  authoritative. ID3 CHAP frames are read when present.
- **Provider chapter titles fill in the rest.** A multi-file book renders one
  segment per file, so `Track.title` *is* the chapter name.
- **LibriVox sections.** Each section's real chapter name comes from
  `sections[].title`. The audio filename comes from `sections[].listen_url`
  (`file_name` is usually null), which lets a section be tied to a specific
  track **by identity rather than by position**.
- **Audnexus chapters.** `GET /books/{ASIN}/chapters` is free and needs no
  token. It is used when the file carries an Audible ASIN (extracted from the
  filename), which is the only key that endpoint accepts.
- **Positional matching is a last resort** and only when the leftover counts
  line up exactly one-to-one. Positional matching is what silently mislabels
  every chapter from the first divergence onward when a book is re-encoded or
  reordered.
- **Never a step backwards.** `isBetterChapterTitle` refuses to replace a
  descriptive embedded title with a generic provider one (`"The Tell-Tale
  Heart"` must not become `"Chapter 3"`), and refuses to overwrite a title the
  user has set. An identical title is reported as *no change*, so a repeated
  enrichment pass does not rewrite rows that are already correct.
- **Chapters are an independent axis.** They are applied regardless of the
  spec 16 auto-apply threshold, and are taken from the highest-confidence
  candidate *that has chapters* — not from whichever provider won the title
  match. Open Library frequently outscores LibriVox on a title while having no
  chapters at all.
- **Redundant prefixes are stripped at scan time**, independently of any
  provider, so books with no provider match still read better.
- **A user-set title is a `FieldOverride`, keyed by track *number*.** Not a
  column on `Track`: the scanner deletes and recreates every track row on each
  rescan, so anything stored there is wiped before the next scan. See
  "Hand-set titles" below.
- **No writes to media files.** Track titles live in the database.

## Data model

`ProviderCandidate.chapters: { title, fileName?, startOffsetSec?, lengthSec? }[]`.
`Track.title` is updated in place; no new table.

Hand-set titles reuse the spec 17 `FieldOverride` table with a
`trackTitle:<trackNumber>` field name, so they are covered by the existing
reset endpoints and by the ADR 009 precedence chain.

## Hand-set titles

`PUT /api/audiobooks/:id/tracks/:trackNumber/title` with `{ "title": "..." }`,
or `{ "title": null }` / `""` to release the override and fall back to the
file's own tag.

The key is the track **number**, not its id, for the same reason as the
storage location: the scanner recreates tracks and reassigns ids on every
rescan, so an id-keyed override would be orphaned the next time the library is
scanned. The scanner therefore reads `FieldOverride` *before* it recreates the
rows and re-applies the values as it creates them.

Clearing deletes the override row rather than storing an empty string. An
empty override would block both the scanner and the provider from ever filling
that chapter in again — the opposite of what clearing means. (The spec 17
metadata route documents the same trap for book-level fields.)

There is no chapter-editing UI yet; spec 06 deferred it and this spec does not
add one. The API is what makes the "never overwritten" guarantee enforceable,
and it is what a future editor should be built on.

## Acceptance criteria

- [x] `"Section 01"` becomes LibriVox's real name (`"Chapters I-V"`).
- [x] `"01 - THE TELL-TALE HEART"` loses the redundant prefix even with no
      provider match.
- [x] A descriptive embedded title is never replaced by a generic one.
- [x] Sections match tracks by filename identity, surviving reordering.
- [x] Count mismatches refuse positional guessing.
- [x] A user-set track title is never overwritten.
- [x] Audnexus chapters are used when an ASIN is present.
- [x] A hand-set title survives a rescan (the scanner recreates every track
      row, so the value is re-applied from `FieldOverride`).
- [x] Clearing a title releases the override instead of storing a blank.

## Test coverage

- `server/src/metadata/chapters.test.ts` — 35 unit tests over the pure
  matching rules: prefix stripping (including the `2001 A Space Odyssey` and
  bare-`42` traps), placeholder detection, `isBetterChapterTitle`, and every
  branch of `matchChaptersToTracks`. The misalignment cases get the most
  attention, since positional matching is the thing that silently goes wrong.
- `server/src/metadata/chapters.integration.test.ts` — 6 tests against a real
  database, covering what the unit tests cannot: that a locked track really is
  skipped, that a locked track survives a scan-style delete-and-recreate, and
  that a second pass writes nothing.
- `server/src/app.test.ts` — 7 route tests for the title endpoint: auth, bad
  id, unknown book, unknown track, idempotent re-set, and clearing.

The override tests were verified to fail when the enforcement is removed.

## Notes on delivery

- **The Audnexus provider was dead until this spec.** The base host is
  `api.audnex.us`, not `audnex.us`, and there is **no book-search endpoint** —
  only `/authors?name=`, `/books/{ASIN}`, `/books/{ASIN}/chapters` and
  `/health`. The spec 16 implementation called `audnex.us/books?title=`, which
  has returned 404 for every request since it was written. That is why no book
  was ever enriched by Audnexus, and it invalidated half of ADR 008's premise.
  Audnexus is therefore no longer part of the title-driven chain; it is an
  ASIN-keyed lookup. See ADR 011.
- **ASIN extraction is filename-only** (`B` + 9 uppercase alphanumerics).
  Audible M4B rips usually carry it in the filename, but not always. No M4B
  fixture exists in `test/`, so the atom-based extraction path is unverified.
- **`Creepy Tales` gained no provider chapters** — LibriVox does not hold that
  title, since these folders are archive.org items rather than LibriVox
  projects. Its embedded names were already good, so it lost nothing.
- **Prefix stripping needs two regexes.** One combined pattern is either too
  greedy (eats the `2001` in *2001 A Space Odyssey*) or too weak (misses
  `"(4) Title"`). Each pattern requires its own evidence: a bracket pair, or
  an explicit separator.
- **"Never overwritten" shipped unenforced.** The first version of
  `applyChapterTitles` took a `lockedTrackIds` option that **no caller ever
  passed** — both call sites omitted it — while the spec claimed the behaviour
  was done. The lock now lives in `FieldOverride` and is read inside
  `applyChapterTitles` itself, so no caller can forget it. Worth remembering:
  an unchecked acceptance criterion is not evidence, and this one was only
  caught by reading the call sites rather than the tests.
- **Chapter titles only re-fetch on a forced pass.** The scan resets every
  `Track.title` back to the embedded tag, so `make enrich` (force) must follow
  any scan to restore provider chapter names.
- **Fixed alongside:** an `EnrichmentRun` enqueued while another was in flight
  was stranded at `pending` forever, because `process` returned early on the
  `running` guard and nothing revisited it. Since a scan auto-enqueues a pass,
  this hit every manual run issued during a scan-triggered one.