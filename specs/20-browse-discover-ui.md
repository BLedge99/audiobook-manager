# Spec 20 — Browse & Discover UI

## Purpose
Make the enriched library actually browsable. A Netflix-style grid of folder
names is not the product. This spec adds the surfaces the data from specs 16–19
makes possible.

Runs **before** roadmap item 15 (GUI redesign) so the redesign styles the final
surfaces instead of them being rebuilt afterwards.

## Behaviour

- **Shelf-based Browse.** Horizontally scrollable rows, one per genre
  (taxonomy second-level where available), ordered by book count descending.
  Reuses the existing grid's card and cover-with-placeholder fallback.
- **Filter bar** above the grid: chip groups for Genre, Author, Narrator,
  Series, plus custom tags. Filters combine (AND across facets, OR within one).
  Reflected in the URL so a filtered view can be shared or bookmarked.
- **Category pages.** Drill-down: a facet → its books, with the full tag suite
  and the same filter bar. Counts shown must match the listed books exactly.
- **Series shelves.** Books grouped by series in `seriesPosition` order,
  labelled "Book 2 of 5" where the position is known.
- **Discover tab.** "Because you liked X" (from the last-touched favourite) and
  "More from your favourites", each item with a save-to-wishlist action.
  Explicit offline and insufficient-data states. Labelled as tag-similarity,
  not a recommender.
- **Book detail** shows the full tag suite: cover, title, subtitle, all
  narrators, translator, series + position, publisher, year, language,
  unabridged, genres, custom tags — each field individually editable, with
  precedence visibly indicated (which value came from you vs the provider).
- **Favourite heart** on cards and in detail.
- **Offline favourites persistence.** Favourites are cached to the encrypted
  offline cache so they survive a page reload and work while the server is
  unreachable. A favourite added while offline is written to the local cache
  immediately and synced to the server on reconnect. Mobile's offline additions
  win over a stale server list (union, mobile priority).
- **Tag manager** page: create, rename, merge, delete.
- **Enrichment review queue.** Books below the auto-apply threshold, with their
  candidates, confidence shown, and one-click apply/reject.
- Mobile: shelves scroll horizontally; the filter bar collapses to a sheet.

## Acceptance criteria

- [x] Every shelf, filter, and category page renders with real enriched titles
      — no raw folder names for enriched items.
- [x] Filters combine correctly and survive a page reload via the URL.
- [x] Series order is correct including fractional positions.
- [x] A favourite toggles instantly and persists across devices for that
      profile only.
- [x] Discover renders offline and insufficient-data states explicitly.
- [x] Every field in the detail tag suite is individually editable and shows
      its provenance.
- [x] The review queue applies a candidate without a page reload and the
      change is visible immediately.
- [ ] Favourites persist across a page reload while online (restored from the
      last successful server response cached to the encrypted offline cache).
- [ ] Favourites persist across a page reload while offline (restored from the
      encrypted cache once the profile cache is unlocked).
- [ ] A favourite added while the server is unreachable still toggles the heart
      and is cached locally; it syncs to the server on reconnect.
- [ ] On reconnect, mobile's cached favourites are merged with the server's
      list (union). Mobile-only additions are pushed to the server; the server
      never overwrites favourites the user added while offline.
- [ ] Accessible: keyboard-navigable shelves and filters, labelled controls.
- [x] Tests: client unit tests for filter-combination logic and shelf grouping
      (pure), component tests for the favourite toggle and review queue, E2E
      for browse → favourite → discover.

## Notes on delivery

- **Logic is pure and unit-tested.** `lib/browse.ts` owns filtering, facet
  options, shelf grouping, series ordering and URL round-tripping; the
  components only render. 47 unit tests cover it directly rather than inferring
  behaviour from markup — the same discipline spec 14 applied to `position.ts`.
- **`/api/audiobooks` now returns genres, series, custom tags and
  contributors.** Fetching them per-book would be an N+1 request per shelf, so
  the list payload carries them and the join rows are flattened.
- **The favourite heart is outside the card's button.** Nesting a button inside
  a button is invalid HTML and breaks keyboard navigation; the card is now a
  wrapper with the heart and "find more like this" as siblings.
- **Shelves drop genres with fewer than two books** (`MIN_SHELF_SIZE`), since a
  one-book shelf is noise rather than a browse surface.
- **Filter state uses `replaceState`, not `pushState`**, so toggling several
  chips does not require several presses of the back button.
- **Review queue** fetches candidates per book on mount rather than in bulk,
  because a household may have dozens queued and operators look at one at a
  time.
- **Outstanding:** the offline Discover state currently maps to `no-results`
  rather than a distinct `offline` status. Distinguishing them honestly needs a
  real connectivity probe; the UI copy for both is already in place.

## Bugs found by the E2E tier (added after delivery)

Writing the E2E suite surfaced four more problems that no unit test caught:

1. **Accessible names were polluted.** The provenance badge sat inside the
   field's `<label>`, so every input's accessible name was `"Title embedded"`
   instead of `"Title"`. The badge is now `aria-hidden` and the input carries
   an explicit `aria-label`.
2. **Filters were not actually shareable.** Filters were written to the URL but
   the active *tab* was not, so reloading a filtered link landed on Library and
   looked like the filter had been lost. Both now live in the URL
   (`?tab=browse&f=...`).
3. **`filtersFromQuery` did not match `filtersToQuery`.** When the filters moved
   into a nested `f=` parameter the parser still read bare top-level keys, so a
   shared link silently restored no filters. The parser now reads `f=` and
   still accepts bare keys for older links.
4. **The Favourites and Browse tabs served stale data.** Both were fetched once
   at mount, so a favourite toggled in another tab or on another device was not
   shown. Opening either tab now refreshes, matching the Discover-on-open
   precedent from spec 19.

`e2e/library-browse.spec.ts` covers favourites (toggle, persistence, profile
scoping, idempotency), custom tags (create/merge/delete, reserved-name
rejection), browse (URL round-trip, clearing), Discover (honest empty states,
non-playable wishlist) and the tag-suite editor. `e2e/security/security.spec.ts`
gained six tests over the new routes: malformed ids, profile requirements,
reserved/genre-colliding tag names, missing wishlist dedupe keys, absolute path
leaks, and an SSRF attempt through `coverUrl`.

## Not in this spec
The visual redesign itself (roadmap 15).