# Spec 18 — Favourites & custom tags

## Purpose
Let each profile mark books they love, and let the household maintain their
own tagging vocabulary. Favourites are the seed for spec 19's recommendations.

## Behaviour

- **Favourites are per profile.** `Favourite(profileId, mediaItemId)` with a
  unique constraint. Toggling is idempotent. A profile's favourites are
  private to that profile; no cross-profile leakage.
- **Custom tags are a managed, household-wide vocabulary.** A `Tag` row is
  created once ("cosy", "long", "bedtime") and assigned to any number of
  books. There is a management page: create, rename, merge, delete.
- **Merge is required, not optional.** Free-typing creates sprawl ("great",
  "GREAT", "good"). Merging one tag into another reassigns every assignment
  and reports how many books moved.
- **Reserved names.** Tag names may not collide with a genre name or a
  reserved word (`all`, `favourites`, `discover`, `wishlist`) — these are
  client-side routes/tabs. Rejected with a 409.
- **Metadata source.** Tags are user data, and so are overrides: a tag
  assignment survives rescan and re-enrichment, because enrichment never
  touches `MediaItemTag`.
- **Counts.** Genre/tag/category pages show a book count, computed from the
  same query that lists the books, so the two can never disagree.

## API deltas

- `PUT /api/audiobooks/:id/favourite`, `DELETE /api/audiobooks/:id/favourite`
- `GET /api/favourites` — current profile's favourites, full tag suite
- `GET /api/tags`, `POST /api/tags`, `PATCH /api/tags/:id`,
      `DELETE /api/tags/:id`
- `POST /api/tags/:id/merge` — body `{ targetTagId }`, returns books moved
- `PUT /api/audiobooks/:id/tags` — assign/replace this book's custom tags

## Acceptance criteria

- [x] Favouriting in one profile does not affect another.
- [x] Un-favouriting twice is a no-op, not an error.
- [x] A tag can be created, assigned, renamed and merged; merging moves every
      assignment and reports the count.
- [x] Reserved and genre-colliding tag names are rejected with a 409.
- [x] Tag assignments survive a full rescan and a re-enrichment pass.
- [x] Category pages show a count that matches the listed books exactly.
- [x] Tests: favourite isolation + idempotency, tag CRUD, merge reassignment,
      reserved-name rejection, rescan survival, count/list agreement.

## Notes on delivery

- **One route, not two.** `PUT /api/audiobooks/:id/tags` originally existed
  twice: spec 17 owned the metadata/genre fields and spec 18 wanted the custom
  tags. Fastify rejects a duplicate method+path, and more importantly two save
  routes would let the detail screen half-apply an edit. The route now accepts
  the whole suite (`title` … `genreIds`, `tagIds`) and saves once.
- **Genre-collision matching normalises both sides.** Comparing a tag key
  ("mystery thriller") against a genre *slug* ("mystery-thriller") never
  matches, which would have made the collision check dead code. Both sides are
  normalised before comparison.
- **Rescan survival** holds structurally: tag and favourite assignments live in
  join tables the scanner's reconciliation never touches, and the scanner only
  upserts `MediaItem` scalars. Covered by `tags.integration.test.ts` plus the
  cascade tests.

## Not in this spec
Recommendations (19), browse UI (20).