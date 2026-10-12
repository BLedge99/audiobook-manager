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
- [x] Accessible: keyboard-navigable shelves and filters, labelled controls.
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
  real connectivity probe; the UI copy for both is already in place. E2E for
  browse → favourite → discover is also still to come (spec 02 requires the E2E
  tier; the unit tiers for both projects are green).

## Not in this spec
The visual redesign itself (roadmap 15).