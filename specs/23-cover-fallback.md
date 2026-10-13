# Spec 23 — Cover art chosen independently of the winning candidate

## Purpose
A book's cover came only from the provider that won the title match. When that
provider has no cover to give, the book shipped with no artwork even though
another candidate in the same run had one.

LibriVox is the common case: its feed exposes **no cover-art field at all**
(`LibrivoxBook` carries `url_librivox`, a project page, not an image), and
Audnexus has been ASIN-keyed since ADR 011. So the provider best placed to
identify a LibriVox recording is the one least able to illustrate it.

## Behaviour
- **The cover is its own axis.** When the winning candidate has no `coverUrl`,
  the highest-confidence candidate that *does* has one supplies the image.
- **Only the image is borrowed.** No other field is taken from the fallback
  candidate, so a lower-confidence match can never overwrite a better one. This
  is the same rule spec 21 applies to chapter titles.
- **Existing guarantees are unchanged.** A cover is still not downloaded when
  the book already has one, or when `coverImagePath` is user-overridden.
- **No new provider, no new endpoint.** `selectCoverSource` only chooses between
  candidates the chain already returned. Guessing at an undocumented cover URL
  is explicitly rejected — that is what kept Audnexus 404ing silently through a
  whole feature (ADR 011).

## Data model
None. `Track`/`MediaItem` are untouched.

## Acceptance criteria
- [x] A book whose winning candidate has no cover gets one from another candidate.
- [x] The highest-confidence candidate that has a cover is the one chosen.
- [x] `selectCoverSource` returns null when no candidate has a cover.
- [x] An empty-string `coverUrl` is not treated as a cover.
- [x] Only the cover is taken from the fallback, not other fields.
- [x] An existing local cover is still not replaced.

## Test coverage
`server/src/metadata/metadata.test.ts` — 6 unit tests for `selectCoverSource`:
winner-without-cover, winner-with-cover, confidence ordering, empty `coverUrl`,
empty list, and provider-key propagation so the stored filename records where
the artwork came from.

## Correction to the audit that prompted this

This spec was written after an audit reported "covers 0/6" on the live
library. **That finding was wrong.** It measured `coverImagePath` from
`GET /api/audiobooks`, but `publicMediaItem` deliberately strips that field —
spec 11 forbids leaking server filesystem paths — and covers are served by
`GET /api/audiobooks/:id/cover`. Measured the right way, the library had **4/6**
covers, three of them downloaded before this work started.

So this is an enhancement, not a bug fix. It does add real value: measured
after the change, the LibriVox-matched Dickens collection gained a cover it
could not previously obtain, because its winner (LibriVox) has no cover field
and nothing else supplied one. The two remaining uncovered books are both
correct: one is below the auto-apply threshold, and the other's candidates
genuinely carry no cover URL.

The lesson is the same one that produced ADR 011: measure the thing the system
actually serves, not a convenient proxy for it.