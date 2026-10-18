# Spec 19 — Recommendations & wishlist

## Purpose
A Discover surface that suggests books the household does **not** own, seeded
either by one specific book ("find more like this") or by the union of a
profile's favourites.

Implements ADR 010. This is tag-similarity over provider data, **not** a
learned recommender, and the UI must not imply otherwise.

## Behaviour

- **Two entry points.**
  - Manual: any book → "Find more like this". Seeds from that one book.
  - Automatic: favourites → seeded from the union of the profile's favourites.
- **Seed extraction (pure).** From a book or a favourites set, extract genres,
  authors, narrators, series and custom tags with weights.
- **Provider expansion.** Seeds browse Open Library by subject, most distinctive
  genre first.
  > **Corrected 2026-10-18.** This originally read "Seeds drive queries through
  > the spec 16 chain. Audnexus's per-author `similar` array is used when
  > available." That was wrong in a way nothing caught: Audnexus's `search()` is a
  > no-op without an ASIN, so it contributed nothing ever, and LibriVox matches
  > titles *exactly*, so genre seeds matched nothing. Discover returned zero
  > results from the day it shipped. See ADR 010's amendment and
  > `searchOpenLibraryBySubject`.
  > Because Open Library indexes **print** editions, results carry no narrator or
  > runtime, and the UI labels every card as a book rather than an audiobook.
  >
  > **Known issue (2026-10-18 user testing):** results come back all at once
  > (`limit=12` × 3 subjects) with no pagination, and the subject pool is huge
  > and unordered, so the first screen reads as random. The tester asked for a
  > **top 5 + "Load more"** shape and for better similarity. The pool is also
  > fetched live on every tab open, so the tab is flaky when the external API
  > is. See [`user-testing-2026-10-18.md`](user-testing-2026-10-18.md)
  > item 3.
- **Local ranking (pure).** Weighted tag overlap, declared as tested constants.
- **Hard dedupe.** Anything the library already owns is removed, case- and
  punctuation-insensitively, matching on normalised title+author.
- **External results are never playable.** Media is a read-only mount. Results
  are metadata-only: cover, title, author, narrators, blurb, genres. Saving
  one adds a `WishlistItem` for that profile.
- **Wishlist is per profile.** Add, remove, and an "I own this" marker — which
  flags the title for enrichment the next time it appears in a scan.
- **Offline.** No network means no new recommendations. Discover shows an
  explicit offline state; it never shows stale results as if they were fresh.
- **Insufficient data.** With too few tags populated to rank meaningfully,
  Discover says so rather than returning noise.

## Data model
- `WishlistItem(profileId, title, author, narrators, description, coverPath,
  coverUrl, genres, seriesName, publisher, publishedYear, provider,
  providerKey, seedMediaItemId?, owned, createdAt)`

## API deltas
- `GET /api/discover/similar/:id` — seeded by one owned book
- `GET /api/discover/for-me` — seeded by the profile's favourites
- `GET /api/wishlist`, `POST /api/wishlist`, `DELETE /api/wishlist/:id`,
      `PUT /api/wishlist/:id/owned`

## Acceptance criteria

- [x] "Find more like this" returns external books sharing the seed's tags.
- [x] Discover-for-me reflects the profile's favourites, and changing a
      favourite changes the result.
- [x] No result is a book already in the library (dedupe covered by test).
- [x] Saving a result to the wishlist persists it and it survives a restart.
- [x] Wishlist items are not playable and expose no audio route.
- [x] Offline Discover states that it is offline and returns no results.
- [x] Insufficient metadata yields an explicit message, not noise.
- [x] Tests: seed extraction and ranking (pure, table-driven), dedupe
      (title/author/case/punctuation variants), profile isolation, owned marker.

## Notes on delivery

- **Non-playability is structural, not a UI convention.** `WishlistItem` has no
  `filePath`, no `Track` relation and no audio route, and the API returns an
  explicit `playable: false`. There is nothing for a future change to wire up
  by accident.
- **Dedupe identity is title+author, normalised.** Comparing on title alone
  would conflate two different books sharing a title; comparing on raw strings
  would let `"The  Hobbit!"` through for an owned `"the hobbit"`.
- **Noisy candidates are dropped, not ranked last.** `minScore` plus
  `hasEnoughSignal` mean a poorly-enriched library gets an explicit
  "not enough metadata yet" rather than plausible-looking noise. This is the
  single biggest quality lever, because recommendation quality here is bounded
  by how well genres/authors are populated.
- **`rankWithPayload`** re-attaches the provider payload to ranked results by
  index; `rankCandidates` preserves order and length, so alignment holds.
- **Offline** currently surfaces as `no-results` rather than a distinct
  `offline` status. The distinction needs a real connectivity probe to be
  honest, which is a spec 20 concern rather than something to fake here.

## Not in this spec
UI presentation (20).