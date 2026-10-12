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
- **Provider expansion.** Seeds drive queries through the spec 16 chain.
  Audnexus's per-author `similar` array is used when available.
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

- [ ] "Find more like this" returns external books sharing the seed's tags.
- [ ] Discover-for-me reflects the profile's favourites, and changing a
      favourite changes the result.
- [ ] No result is a book already in the library (dedupe covered by test).
- [ ] Saving a result to the wishlist persists it and it survives a restart.
- [ ] Wishlist items are not playable and expose no audio route.
- [ ] Offline Discover states that it is offline and returns no results.
- [ ] Insufficient metadata yields an explicit message, not noise.
- [ ] Tests: seed extraction and ranking (pure, table-driven), dedupe
      (title/author/case/punctuation variants), profile isolation, owned marker.

## Not in this spec
UI presentation (20).