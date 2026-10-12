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

- [ ] Every shelf, filter, and category page renders with real enriched titles
      — no raw folder names for enriched items.
- [ ] Filters combine correctly and survive a page reload via the URL.
- [ ] Series order is correct including fractional positions.
- [ ] A favourite toggles instantly and persists across devices for that
      profile only.
- [ ] Discover renders offline and insufficient-data states explicitly.
- [ ] Every field in the detail tag suite is individually editable and shows
      its provenance.
- [ ] The review queue applies a candidate without a page reload and the
      change is visible immediately.
- [ ] Accessible: keyboard-navigable shelves and filters, labelled controls.
- [ ] Tests: client unit tests for filter-combination logic and shelf grouping
      (pure), component tests for the favourite toggle and review queue, E2E
      for browse → favourite → discover.

## Not in this spec
The visual redesign itself (roadmap 15).