# Spec 15b — Post-testing polish

## Purpose

Seven findings from real household use on two phones, recorded verbatim with
their measured causes in
[`user-testing-2026-10-18.md`](../user-testing-2026-10-18.md). The tester's
verdict was that the app is in a great place; none of these are blockers. They
are polish and correctness, and they supersede the ordering that
`LIMITATIONS.md` §6 proposed before anyone had used the app.

This spec is the contract for all five items that ship in this pass. It is one
spec because they are one change session, reviewed as one body of work; each
lands as its own commit.

## Scope

| # | Finding | Why it is in this pass |
|---|---------|------------------------|
| 4 | Refresh leaves the library empty for about a minute | Small, high-visibility, and it makes the app look broken |
| 5 | The player should be at the top of the book page | Small; the app's own thesis is that the device is a player |
| 1 | Cover art is unstable | The largest real gain, and the only one that needs a new store |
| 3 | Discover is flaky, random and unbounded | Needs pagination *and* ranking to be worth having |
| 7 | The copy needs a review | Last, so it does not fight the layout moves above it |

Explicitly out of scope, with reasons recorded rather than left open:

- **Finding 2 (per-profile privacy)** needs its own ADR before code: a new auth
  level, a schema change and a biometric path. Spec 11's auth-model constraints
  have to shape it, not follow it.
- **Finding 6 (lock-screen latency)** must be measured before it is fixed.
  `LIMITATIONS.md` §5 records two false diagnoses in exactly this area, so a
  guessed fix is worse than none.
- **Storage management** (the downloaded-books list and "Remove from device")
  stays an unmet spec 26 acceptance criterion. The user removed it from this
  pass on 2026-10-19; it is recorded in `LIMITATIONS.md` so it is not lost.
- The wordmark rename to Bookle, which `PRODUCT.md` records as unscheduled and
  `e2e/helpers.ts:42` blocks.

## Behaviour

### 4 — A refresh never blanks the library

Three defects share one root: **state that means "loading" when it means
"refetching"**.

- `loading` is true only while there is nothing to show. A refetch that already
  has rows keeps rendering them, with a small "Refreshing" indicator. Only an
  initial fetch with no data may say "nothing in library".
- Requests coalesce. Focus, `visibilitychange`, the player's final save, the scan
  poller and a manual tap all pass through one in-flight promise, so they cannot
  stack. A double-tap on refresh cannot either.
- The library refetches once **after a profile is selected**, closing
  `LIMITATIONS.md` §1.7. Today the first fetch happens before a profile exists,
  so the response carries no progress and nothing refetches it.
- `GET /api/audiobooks` answers `304` to a matching `If-None-Match`. The tag is
  computed over the rows *and the caller's progress*, so a 304 can never be
  correct for the wrong profile. A refresh that changed nothing costs bytes, not
  a round trip's worth of JSON.

### 5 — The player is the top of the book page

The detail dialog opens on cover, title, author, narrator, the download control
and **the player**, followed by the actions a listener uses (favourite, find
more like this) and a one-line fact strip. Everything else — series, publisher,
description, the tag suite and the online metadata lookup — sits in a **"Book
details" fold, closed by default**.

This is a reorder, not a rebuild. Spec 14's `position.ts` and
`ProgressTimeline` are reused untouched, and the dialog's DOM stays
`div.fixed.inset-0 > article` because `e2e/phone-layout.spec.ts` locates it
that way.

A side effect worth having: the tag suite unmounts while the fold is closed, so
`useTagSuite(book.id)` stops firing a request every time someone opens a book.

### 1 — Covers are cached on the device, and rendered in three states

The observed failure had three symptoms with one cause: cover URLs are fetched
live by `<img>` on every render, nothing caches them, and the fallback is a
single boolean.

**Server.** `GET /api/audiobooks/:id/cover` sends `Cache-Control: private,
max-age=86400` and an `ETag` derived from the file's mtime and size, so
Fastify answers `304` for a matching `If-None-Match`. `private`, never
`immutable`: an operator can re-enrich and change the art, so the cache must be
able to end.

**Device.** Covers live in IndexedDB (`covers` table in the existing Dexie
database, added as version 2), keyed `book:<id>` for library covers and
`url:<href>` for the provider URLs Discover and the wishlist use. Records carry
the blob, its `ETag`, a save time and a byte count.

- Fetches are **conditional**: a `304` keeps the stored bytes, a `200` replaces
  them. A cover that changes on the server changes on the device.
- Concurrency is bounded and per-key deduplicated, so a fast scroll cannot fire
  one request per card.
- Fetching starts when a cover nears the viewport (`IntersectionObserver`),
  which replaces `loading="lazy"` — that attribute still issues a request for
  every card on screen.
- Object URLs are reference-counted and revoked on eviction; the store is capped
  by bytes and evicted least-recently-used.

**One element, three states.** A single `CoverArt` resolves any cover, on every
surface: grid, dock, shelves, detail, Discover, wishlist and the review queue —
which today are four separate `<img onError>` sites that each fail separately.

| State | Rendered |
|---|---|
| Cached and known good | the image, immediately, never refetched for the session |
| Pending or known bad | the placeholder — never a network URL |

**The structural point:** the `<img>` is never handed a network URL, only a blob
URL it can decode. That is what removes the "solid colour with no placeholder"
case — it was an `<img>` whose bytes were not a valid image, painted before
`onError` fired. It cannot be painted if it is never given a source that can
fail.

**Accepted cost, stated plainly:** caching makes a wrong cover *sticky*.
`LIMITATIONS.md` §2.7 already records that these are cover editions from a book
catalogue, not the artwork of the audiobook you own. A local cache makes that
more visible, not less. The `ETag` is the only thing that unwedges it.

**Why IndexedDB and not a service worker:** service workers are unreliable in the
Capacitor WebView (they do not work well with Capacitor, and not at all on
WKWebView). Covers have to survive offline *in the native shell*. The HTTP cache
headers still earn their keep for the browser and the PWA, where they are the
whole fix.

### 3 — Discover returns five ranked suggestions, and a button for the rest

Pagination and ranking are **one change**, not two. A "load more" over a random
subject pool is still random.

- Open Library subject search gains documented `page`/`limit` paging, an
  identifying `User-Agent` (identified requests get 3× the rate limit; the
  anonymous budget is ~100 requests per 5 minutes), and a timeout so a hung
  provider cannot produce the "no results for a while" the tester saw.
- Pools are cached per `subject:page` with a TTL, so opening the tab a second
  time is instant and does not re-hit a free public API.
- Expansion fetches several pages, **merges them, ranks the merged pool once,
  and then slices it**. Page two is a slice of the same ranking, not a fresh
  draw. This is the actual fix for "results at random".
- Ranking keeps the existing genre/author/series weights as its base and adds
  published-decade proximity, series proximity and a cover-present bonus, all as
  pure tested functions.
- Both discover routes take validated `?page=` and return `page`, `pageSize`,
  `hasMore` and `total`. The UI renders five and a "Show 5 more" button.

The honesty rule from `LIMITATIONS.md` §1.8 is unchanged: these are print
records with no narrator and no runtime, every card stays labelled as a book
rather than an audiobook, and the wishlist remains the load-bearing part of the
feature.

### 7 — One voice, in one table

Copy is written inline across ~20 components and has never been reviewed as a
whole. The redesign introduced most of it in one pass and it reads
inconsistently.

- Every user-facing string moves into `client/src/copy.ts`, keyed by surface,
  including the default labels inside the shared primitives. A text change
  becomes a one-line edit rather than a component hunt, and the review becomes
  auditable in one sitting.
- One register, chosen and recorded: **warm, plain and brief**. Not corporate,
  not jokey. The capsule world is friendly; operator screens stay plain.
- Existing commitments hold: status colour never travels alone, sentences are
  short, numbers are figures, and no exclamation marks.
- The decision is recorded in `PRODUCT.md`, which currently lists voice as
  undecided.

## Acceptance criteria

**Refresh**

- [ ] Refreshing with books already on screen never renders an empty state.
- [ ] A "Refreshing" indicator is visible for the duration of the request.
- [ ] Three simultaneous triggers produce one request.
- [ ] Selecting a profile refetches the library, so progress is present on arrival.
- [ ] `GET /api/audiobooks` returns `304` for an unchanged library *and* for
      unchanged progress, and never reuses one profile's tag for another's.

**Player first**

- [ ] Opening a book shows the player without scrolling.
- [ ] Metadata, tags and the metadata lookup are reachable in one tap and hidden
      by default.
- [ ] Spec 14's position display is unchanged: chapter, position in chapter,
      book percentage, time left, chapter ticks, session-start marker.
- [ ] `e2e/phone-layout.spec.ts` passes without editing an assertion.

**Covers**

- [ ] A cover that has been seen never disappears when the network fails or the
      phone is in airplane mode.
- [ ] No surface shows a broken frame or a solid colour in place of a cover.
- [ ] Every cover surface — grid, dock, shelves, detail, Discover, wishlist,
      review queue — resolves through the same element and cache.
- [ ] A cover changed on the server replaces the cached one.
- [ ] Scrolling a full grid does not issue one request per card at once.
- [ ] Book covers and provider-URL covers both work.

**Discover**

- [ ] Five suggestions render at a time, with a "Show 5 more" button that
      appends five and disappears at the end.
- [ ] Reopening the tab does not re-request the same subjects.
- [ ] A provider that hangs produces a message, not an indefinite blank.
- [ ] Results are no longer all-or-nothing from a single unranked pool.

**Copy**

- [ ] `client/src/copy.ts` holds every user-facing string; components hold none
      inline.
- [ ] `PRODUCT.md` records the voice decision.

**Whole pass**

- [ ] `npm --prefix client test`, `npm --prefix server test`, `npx tsc --noEmit`,
      `node scripts/capture-ui.js` and `npx playwright test` all pass, with no
      existing assertion weakened.
- [ ] On device: covers survive airplane mode after a single online load.

## Verification

Per feature: unit tests → `tsc --noEmit` → `capture-ui.js` → Playwright in a
**single WSL session** (Docker idles out between sessions and the failure looks
like a code bug). One commit per feature.

The cover cache additionally gets a manual on-device pass, because it is the
one item that must work offline in the native shell and IndexedDB in a WebView
is not the same thing as IndexedDB in Chromium. Per `LIMITATIONS.md` §5, an APK
is never rebuilt while someone is mid-listen, and what is *installed* is
verified rather than what is on disk.

## Not in this spec

Findings 2 and 6, storage management, the wordmark rename, and the dependency
security debt in `LIMITATIONS.md` §4.
