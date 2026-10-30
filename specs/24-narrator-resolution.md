# Spec 24 — Narrator resolution from local sources

## Purpose
Commercial audiobooks were showing **no narrator at all**. Measured on the
mixed fixture library on 2026-10-13: narrator populated on 3 of 12 books, and
all five multi-file Harry Potter sets were empty despite the narrator being
present in the files.

## Why not fetch it online
Tested live rather than assumed:

- **Audnexus** carries narrators but is ASIN-keyed, and none of the fixture
  books carry an ASIN in any filename, tag or atom.
- **Open Library** editions expose `isbn_10`/`isbn_13` and contributors like
  `Illustrator`; no narrator contributor on any edition checked.
- **Google Books** / **Apple iTunes** expose no narrator field.
- **LibriVox** has real `readers`, but 404s for commercial titles.

The reason is structural: **a narrator belongs to a recording, not to a book.**
"Harry Potter and the Goblet of Fire" has dozens of recordings, so a title
search finds the *work* and still cannot say who read *this* copy. Book
catalogues therefore do not model a narrator, and that is not an oversight.

So the narrator is read from the files, which needs no network and cannot fail
when a provider has an outage.

## Behaviour
Sources are tried in order and the first that yields a name wins:

1. **`composer` atom** — the Audible convention. Already worked.
2. **`comment` field** — `Read By X`, `Narrated by X`, `Narrator: X`.
3. **Folder name** — a bracketed segment only: `{X}`, `(X)`, `[X]`, with an
   optional `Narrated by` prefix inside the brackets.

Additional rules:
- **A full cast becomes one contributor per person.** `Read by Scott Brick and
  David Most` yields two, because the narrator filter matches per person.
- **A false positive is worse than a miss.** A book silently credited to
  "Unabridged" is a lie the UI will show, so a candidate must pass
  `looksLikePersonName`: at least two tokens, each starting uppercase, no
  digits, no path separators, and not on a small stoplist (`unabridged`,
  `retail rip`, `full cast`, `mp3`, ...).
- **Unbracketed folder names are never guessed from.** Too many false
  positives in a real library.
- **No guess is ever made.** If nothing resolves, the field stays empty and
  visible, and the spec 17 tag-suite editor lets a human set it.

## Data model
None. `Contributor.role = "narrator"` already exists and needs no migration.

## Acceptance criteria
- [x] `composer` still wins when present.
- [x] `Read By Stephen Fry` in a comment resolves.
- [x] `{Stephen Fry}` in a folder name resolves.
- [x] `(Narrated by Stephen Fry)` resolves, prefix stripped.
- [x] A full cast in one tag becomes multiple contributors.
- [x] `Unabridged`, `Retail Rip`, `MP3` in brackets do **not** resolve.
- [x] An unbracketed folder name does not resolve.
- [x] Nothing resolving returns null rather than a guess.
- [x] The stored display string is comma-joined for a multi-narrator book.

## Test coverage
`server/src/narrator.test.ts` — 22 unit tests. The negative cases are weighted
more heavily than the positive ones, because the folder heuristic is the
weakest source and a false positive is worse than a miss. Includes a table test
over the exact six commercial fixtures, asserting both the three that must
resolve to Stephen Fry *and* the two that must resolve to nothing.

## Not in this spec
- **An `actor` role.** Verified dead upstream: Audnexus returns only
  `narrators`, with no `actors`/`performers`/`cast` field anywhere in the
  payload. Audible does not distinguish them either, so full-cast performers
  are already captured as narrators.
- **Wiring Audnexus in.** Blocked on ASIN discovery, which has no free
  solution (see the handoff). The provider code exists and is tested; it is
  simply unreachable for libraries without ASINs.
- **Online narrator lookup by title + duration.** Sound in principle — duration
  distinguishes a recording — but every source that could answer is ASIN-gated.