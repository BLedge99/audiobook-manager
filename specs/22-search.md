# Spec 22 — Search

## Purpose
The browse surface can only filter by clicking chips for values that are
already in the library. There is no way to type a query, so "everything by
Dickens", "anything thriller", or "what was that book about the lighthouse"
are all unanswerable. This spec adds a typed search over the same fields the
chips already use.

## Audit that prompted this (2026-10-13, live stack, 6-book fixture library)

- `GET /api/audiobooks` accepts **no query parameters at all**. `?q=`,
  `?search=`, `?author=` and `?genre=` are silently ignored and each returns
  the entire library — a caller filtering by author gets every book back and no
  error. `/api/search` does not exist.
- All filtering is therefore client-side, which is fine at household scale
  (the whole library is already in memory) but means it must be correct and
  tested as pure logic.
- The chips cover genre / author / narrator / series / tag only, and only
  exact values. There is no substring matching, so `rowling` cannot find
  `J.K. Rowling`.
- `facetValues(book, "author")` reads `MediaItem.author` while the narrator
  facet prefers the reconciled `contributors` rows. Author survives a manual
  override through the field, narrators do not, so the two facets read from
  different sources.

## Behaviour

- **Bare words are free text.** They match the title, author, narrators,
  series, genres, custom tags and description, case-insensitively, on
  substrings — so `lighthouse` finds a book that only mentions it in the blurb.
- **`field:value` is a facet filter.** Supported fields are `author`,
  `narrator`, `genre`, `series` and `tag`. Values match on substrings too, so
  `author: rowling` matches `J.K. Rowling`. Case-insensitive.
- **`author: rowling` and a clicked Author chip agree.** Typed facets resolve
  against the same `facetValues` source the chips use, so the two never
  disagree about who counts as the author.
- **Quoted values keep spaces.** `author:"J.K. Rowling"` is one term;
  `author:"J.K. Rowling" narrator:Vance` is two.
- **Terms AND together.** `dickens audiobook` returns books matching both, so
  narrowing never widens the result.
- **A field:value term with an unknown field is free text**, not an error, so
  `isbn:123` or a typo degrades to a normal search rather than returning
  nothing.
- **Empty terms are dropped**, and a whitespace-only query matches everything.
- **Typing a facet does not disturb the chips.** Typed facets are a separate
  layer from the `Filters` state the chips and the URL serialise, because a
  typed value is usually a *substring* (`rowling`) rather than an exact facet
  value (`J.K. Rowling`) and would otherwise silently filter everything out.
- **The search narrows; it never widens.** An empty query returns the input
  array unchanged.
- **No new API.** This is a client concern; the server keeps returning the
  whole library.

## Data model
None. The query lives in the URL as `q=` so a search is shareable and survives
reload, alongside the existing `f=` filter state.

## Acceptance criteria

- [x] `author: Rowling` returns only Rowling books.
- [x] `genre: Thriller` returns only books carrying that genre.
- [x] `author:"J.K. Rowling"` treats the quoted value as one term.
- [x] Multiple terms AND together.
- [x] Bare text matches title, author, narrator, series, tag, genre and description.
- [x] Matching is case-insensitive and substring-based.
- [x] An unknown `field:` falls back to free text instead of returning nothing.
- [x] An empty or whitespace-only query returns everything.
- [x] Typed search and chip filters compose (both apply).
- [x] The query round-trips through the URL.

## Test coverage

- `client/src/lib/search.test.ts` — 27 unit tests over `parseSearchQuery`,
  `matchesSearch`, `applySearch` and `describeSearch`, including the
  regressions found while writing them: whitespace around the colon
  (`author: rowling` silently degraded to free text without `\s*` in the
  token regex) and a bare `author:` with no value, which would otherwise be
  searched for as literal text and blank the library with no explanation.
- `client/src/components/SearchBar.test.tsx` — 10 render tests: debouncing,
  only reporting the latest value when typed quickly, the match-count line,
  clear-by-button, clear-by-Escape, following an external clear, and filling
  from an example query.
- `e2e/search.spec.ts` — the wiring, which is where this is most likely to
  break: the query narrows the grid, survives a reload through the URL, a
  `field:value` parses and reports zero rather than being ignored, and
  clearing restores the full library.

## Not in this spec

- Server-side search or an index. The library is fetched whole; a `LIKE` query
  would add a second source of truth for the same rows.
- Fuzzy/typo-tolerant matching, stemming, or ranking by relevance. Results
  keep library order; scoring is a different feature.
- Searching wishlist/Discover results, which are external books.
- Searching the media *file* name. That is a debugging aid, not a browsing one.