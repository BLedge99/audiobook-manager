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
- **The table reaches further than the components.** The pure maths modules
  speak too — `lib/position.ts` produces "2h 14m left" and "Chapter 4", and
  `lib/browse.ts` produces "Book 2 of 5" — so they read `copy.ts` as well.
  `copy.ts` has no dependencies of its own, so both modules stay pure.
- One register, chosen and recorded: **warm, plain and brief**. Not corporate,
  not jokey. The capsule world is friendly; operator screens stay plain.
- Existing commitments hold: status colour never travels alone, sentences are
  short, numbers are figures, and no exclamation marks.
- The decision is recorded in `PRODUCT.md`, which currently lists voice as
  undecided.

**The rule that matters more than any of them: write for the listener.**

The app has two audiences. There is the **listener** — someone who wants to
find a book and press play — and the **operator** — whoever sets up the server,
scans folders and fixes metadata. They read different screens and need
different words.

**A heading, an explanation or a hint must say why the listener is there and
what they can do, in their terms. It must not describe what the system is
doing.**

The failure mode is a heading like *"Home server library — select books to add
to user library"*. It is a perfectly good comment to a developer and useless
to a person: it names the system's structure, and the person already knows why
they opened a screen called "All books". Said to the listener: **"Select
books to add to your library."**

So the table is split in two:

| Tier | Where | May it say "metadata"? |
|------|-------|------------------------|
| Listener-facing | the top level of `copy.ts` | No |
| Operator-facing | `copy.operator` | Yes — it is what those screens are about |

And the rule is **enforced, not just documented**: `copy.test.ts` fails the
build if the listener tier contains the system's own vocabulary.

**What the review actually changed**, beyond the move:

- **One ellipsis.** The app mixed `…` and `...` across files. It is `…`
  everywhere now, and `copy.test.ts` fails the build if a `...` reappears.
- **One word per concept.** "Use this" was "Use" in the book detail and "Use
  this" in the review queue. "Find more like this", "Add to favourites" and
  "In your favourites" each had two homes. They are one entry each now, at the
  top level of the table, and a test fails if one is copied back into a
  surface group.
- **The system stopped speaking to the listener.** "Metadata updated" on a
  book capsule became "Details updated". "Enrichment assigns genres from the
  curated taxonomy" became "Books get a genre once their details are filled
  in". "Seed your Discover suggestions" became "they help Discover find books
  for you".
- **Errors say what to do next.** "Failed" became "Could not load the matches.
  Try again." "Could not load profiles (HTTP 500)." became "Could not load the
  profiles (HTTP 500). Try again in a moment." — the status code stays, but it
  is no longer the whole message.
- **A sentence where there was a fragment.** The review queue's "currently
  shown as …" became a sentence, and the metadata lookup's "No matches found."
  became "No matches found for this title."
- **Regularity where the app had none.** "Sleep: off" became "Off" beside
  "15 min" and "End of chapter"; "Series #" became "Series number"; the
  lowercase "clear" link became "Clear"; "3 file(s)" became "3 files".
- **Two shelves, so two words.** With spec 27 there is the listener's shelf and
  the household's, and "All audiobooks" used to mean the whole server. The
  Library tab is now "Your audiobooks" and the server shelf is "All audiobooks".

**The one thing that did not change: the honesty rule.** Discover's "Book —
not an audiobook yet" is still there, and so is every card's "not in your
library yet". A copy pass is exactly the wrong moment to soften those.

### 7b — The guardrails, and the second pass

Feature 7 made the copy *reviewable*. It did not make it *enforced*: the review
was one sitting, and the next string added cold can drift again. This is the
follow-up. It sets up the guardrails, records the four decisions the second pass
follows, and then does the pass. The guardrails themselves changed no visible
string.

**The guardrails, in place now:**

- **The checker is vendored, not reimplemented.** `scripts/check-copy.mjs` is the
  `ui-copy` skill's checker, copied verbatim. It reads `client/src/copy.ts`
  against the `consumer-plain` profile and `copy.operator` against
  `professional-b2b`. `npm run check:copy` (or `make check-copy`) runs it with
  `--fail-on-scan`, and it is part of `make test` and CI. A banned word or a
  scan hit fails the build.
- **`scripts/copy.config.json` is the definition of "our words".** It adds the
  product's own banned vocabulary — `bridge`, `plugin`, `session`, `scan`,
  `review queue`, `local-first`, `title`, `retry`, `unable`, `incorrect` — to
  the profile. Its `ignoreKeys` list is now empty: the burn-down is done, and
  the list may shrink but never grow. A *new* string using one of those words
  fails on the next run.
- **The glossary is enforced, not just written down.** `copy.ts`'s `glossary`
  moved from `{ concept: "term" }` to the `{ term, avoid }` shape the checker
  reads. A listener string that says "directory" for a folder now warns, from
  the same file that documents the term.
- **The dynamic entries are checked.** The ~60 messages that carry a value were
  invisible to both the test and the checker, because both skipped function
  values. `copy.test.ts` now renders each with sample arguments and applies the
  same vocabulary and punctuation rules, and an explicit `ICU_PENDING` list names
  every one of them, so a new placeholder message fails until it is
  acknowledged.
- **Dead copy is gone.** `primitiveCopy` was exported and never read; it is
  deleted, because a catalogue of unused strings hides the ones that matter.
- **Two formatting faults in the table are fixed** (a property sharing a line
  with its neighbour, and a mis-indented entry). Neither is visible to a user.

**The four decisions the second pass follows:**

1. **The server stops writing English.** API responses return stable codes and
   values; the client renders the words. A message written on the server is a
   second catalogue, and none of the rules above can reach it. *(Implemented:
   see `decisions/015-api-error-codes.md`. The server now sends `{ code, params }`
   and the client resolves it through `copy.apiErrors` and
   `copy.operator.apiErrors`.)*
2. **The listener never meets the operator's job.** No listener-facing string
   names a folder, a scan or a review queue. Those are things the person who
   runs the server does, and naming them teaches the listener a job they do not
   have. This is the `scan` / `review queue` burn-down above, made a rule.
3. **The password message states a fact, not a verdict.** "Incorrect password."
   becomes "That password doesn't match. Try again." The value does not match,
   and the next step is stated. (Core rule C11.)
4. **Translations are deferred, and labelled.** Placeholder messages stay
   template literals for now; the `ICU_PENDING` list is the migration checklist.
   Nothing here is translated, and nothing pretends to be.

**The second pass (done):**

- ~~Rewrite the `ignoreKeys` strings so the list empties, then move the product
  words into `copy.test.ts`'s `BANNED_WORDS`.~~ Done — the list is empty.
- ~~Pull in the inline literals the checker's scan still misses — literals inside
  JSX expressions and template literals, which today sit in `App.tsx`,
  `Shelves.tsx`, `ui/primitives.tsx`, `useBrowse.ts`, `TagManager.tsx`,
  `ReviewQueue.tsx`, `Settings.tsx` and `ServerSetup.tsx`.~~ Done — the plural
  counts, shelf scroll labels, duration labels and the health-check status moved
  into the catalog; the components that already read `copy` needed no change.
- ~~Move Discover's success-payload prose (`Recommendation.reason`, and the
  `message` explainer on a non-`ok` result) onto codes the client renders. It is
  listener copy, not an error, so it belongs with the wording pass rather than
  with the error contract.~~ Done — the server sends reason and message codes;
  `copy.discover.reason` and the status messages own the words.
- ~~Replace the server's `{ message }` prose with codes the client renders, and
  stop leaking `error.message` in `server/src/app.ts`.~~ Done — ADR 015.
- ~~Then turn on `--fail-on-scan`, fold `check-copy` into `make test`, and add the
  CI workflow (the repository has none today).~~ Done — the checker is a gate,
  `make test` runs it first, and `.github/workflows/ci.yml` runs both suites.

## Acceptance criteria

**Refresh**

- [x] Refreshing with books already on screen never renders an empty state.
- [x] A "Refreshing" indicator is visible for the duration of the request.
- [x] Three simultaneous triggers produce one request.
- [x] Selecting a profile refetches the library, so progress is present on arrival.
- [x] `GET /api/audiobooks` returns `304` for an unchanged library *and* for
      unchanged progress, and never reuses one profile's tag for another's.

**Player first**

- [x] Opening a book shows the player without scrolling.
- [x] Metadata, tags and the metadata lookup are reachable in one tap and hidden
      by default.
- [x] Spec 14's position display is unchanged: chapter, position in chapter,
      book percentage, time left, chapter ticks, session-start marker.
- [x] `e2e/phone-layout.spec.ts` passes without editing an assertion.

**Covers**

- [x] A cover that has been seen never disappears when the network fails or the
      phone is in airplane mode.
- [x] No surface shows a broken frame or a solid colour in place of a cover.
- [x] Every cover surface — grid, dock, shelves, detail, Discover, wishlist,
      review queue — resolves through the same element and cache.
- [x] A cover changed on the server replaces the cached one.
- [x] Scrolling a full grid does not issue one request per card at once.
- [x] Book covers and provider-URL covers both work.
- [x] **On device:** covers survive airplane mode after a single online load.
      Verified on a Pixel 4a / Android 13: Wi-Fi disabled and the server proven
      unreachable, cold-started from a force-stop — both downloaded books render
      with **2 covers from the device cache, 0 from the network**, and the stored
      blobs decode into real artwork. IndexedDB held 11 records / 516 KB of
      `image/jpeg`, closing the `fake-indexeddb` gap below. Screenshot:
      [`evidence/offline-covers-pixel4a-2026-10-19.png`](evidence/offline-covers-pixel4a-2026-10-19.png).

**Discover**

- [x] Five suggestions render at a time, with a "Show 5 more" button that
      appends five and disappears at the end.
- [x] Reopening the tab does not re-request the same subjects.
- [x] A provider that hangs produces a message, not an indefinite blank.
- [x] Results are no longer all-or-nothing from a single unranked pool.

**Copy**

- [x] `client/src/copy.ts` holds every user-facing string; components hold none
      inline. **Verified** — including the strings the pure maths modules
      produce (`lib/position.ts`, `lib/browse.ts`) and the errors that cross
      module boundaries (the API layer, the device bridge, the data hooks).
- [x] `PRODUCT.md` records the voice decision, with the rules it holds to.

**Copy guardrails (feature 7b)**

- [x] `scripts/check-copy.mjs` is the `ui-copy` checker, vendored verbatim, and
      `npm run check:copy` / `make check-copy` runs it.
- [x] The listener tier is read as `consumer-plain` and `copy.operator` as
      `professional-b2b`; the run exits **0**, with the known violations
      itemised in `scripts/copy.config.json` rather than failing the build.
- [x] The product's own words are banned for new strings, and every key still
      using one is listed in `ignoreKeys`.
- [x] The glossary is machine-checked (`{ term, avoid }`), not merely documented.
- [x] Every function-valued message is rendered and checked, and named in
      `ICU_PENDING`, so a new placeholder message cannot be added silently.
- [x] `npm --prefix client test` (358 tests) and `npx tsc -b` stay green, and no
      visible string changes.
- [ ] **Open:** `ignoreKeys` is empty, the inline literals are in the catalogue,
      `--fail-on-scan` is on, `check-copy` is part of `make test` and CI, and the
      server returns codes rather than prose.

**Whole pass**

- [x] `npm --prefix client test`, `npm --prefix server test`, `npx tsc --noEmit`,
      `node scripts/capture-ui.js` and `npx playwright test` all pass, with no
      existing assertion weakened.
      **Re-verified after feature 3** (`cb28038`): server 416 (1 skipped),
      client 295, Playwright 46, `tsc` clean on both tiers, `capture-ui.js`
      reports "layout guards pass". **Re-verified again after feature 7**:
      server 433 (1 skipped), client 325, Playwright 48, `tsc` clean on both
      tiers, `capture-ui.js` "layout guards pass".
- [x] On device: covers survive airplane mode after a single online load.
      Done in feature 1 — Pixel 4a, Wi-Fi off, server unreachable, cold start
      from a force-stop: both downloaded books rendered with **2 covers from the
      device cache and 0 from the network**. Screenshot:
      [`evidence/offline-covers-pixel4a-2026-10-19.png`](evidence/offline-covers-pixel4a-2026-10-19.png).

**The pass also left two things behind for whoever comes next:**

- **`make capture` and `scripts/capture-ui-wsl.sh` now exist.** The design
  capture runs from WSL, where the stack's published ports actually are,
  because from Windows it needs a portproxy whose target address rots every
  time WSL restarts. It shares one session with the compose-up, for the same
  reason `test-e2e` does.
- **`capture-ui.js` waits with a timeout.** A renamed heading used to turn the
  capture into a silent hang instead of a failure that says what is wrong —
  which is how a copy change went unnoticed for a while.

## Verification

Per feature: unit tests → `tsc --noEmit` → `capture-ui.js` → Playwright in a
**single WSL session** (Docker idles out between sessions and the failure looks
like a code bug). One commit per feature.

The cover cache additionally gets a manual on-device pass, because it is the
one item that must work offline in the native shell and IndexedDB in a WebView
is not the same thing as IndexedDB in Chromium. Per `LIMITATIONS.md` §5, an APK
is never rebuilt while someone is mid-listen, and what is *installed* is
verified rather than what is on disk.

## Traps recorded here, because they cost real time

**A route test with a hand-built fixture can be blind to a real payload.**
Feature 4's conditional GET hashed the serialised library payload, which is the
correct way to build an ETag — and it 500'd every request in the running app,
because `Track.sizeBytes` is a Prisma `BigInt` and a bare `JSON.stringify`
throws on it. Fastify's own serialiser handles BigInt, which is exactly why the
endpoint had worked for months.

The unit suite passed throughout: **36 green, including eight new tests written
for the feature.** Every fixture book they seeded had no tracks, so no
`sizeBytes` ever reached the hash. Only the E2E run against the real 12-book
library produced a 500. The fixture now seeds a real track, and a test asserts
two different sizes produce two different tags — which is also what pins the
replacer to a decimal *string* rather than a `Number`, since a number silently
loses precision above 2^53 and equal tags would serve a stale body.

The general rule: **a fixture that is simpler than reality is a test that
cannot fail.**

**jsdom does no layout, so geometry assertions are vacuous there.** The obvious
way to test "the player is above the metadata" is `getBoundingClientRect()`.
In jsdom every rect is `0×0`, so both comparisons are `0 > 0` and the test
passes whatever the markup says. The unit tests compare
`compareDocumentPosition` instead, and the real check is an E2E one that
measures the player's `y` against the viewport — because the defect this feature
fixes is *visual*, and only a browser can see it.

**An empty object stub can throw inside a child and look like the parent never
rendered.** Returning `{}` for the tag-suite response makes `TagSuiteEditor`
throw on `suite.genres.map(...)`; with no error boundary React unmounts the
whole tree, so the fold looks like it never opened and the failure reads as a
state bug. Stubs for a real payload shape, not a plausible one.

**`fake-indexeddb` does not round-trip a `Blob`.** A cover record written and
read back comes with `blob.type` and `blob.size` undefined. So the cache's unit
tests verify the *logic* — found, kept, replaced, revalidated, evicted — and
never that the stored bytes decode. `URL.createObjectURL` is stubbed, which
papers over exactly the thing that is untested. That gap is real, it is named in
`CoverImage.test.tsx`, and it is closed by the on-device pass or not at all.

**A mock's `calls[0]` is not "the call you are looking at".** Asserting on the
first recorded call across a simulated app restart silently asserts the *first
session's* request — which is unconditional, and looks exactly like a failing
conditional fetch. Record the call boundary before switching sessions. Sessions
are modelled with `vi.resetModules()`, which is what reopening the app actually
is: the cache's "revalidated at most once per session" is enforced by module
state, and a re-render inside one session must *not* refetch.

**An E2E assertion that a thing is absent passes when the thing never happened.**
This is the worst one here, because the cover test was green for a build where
**no cover was ever fetched**. It asserted "no `<img>` points at the network",
which is trivially true when every image is a placeholder — which is exactly
what was on screen. The fix asserts the *positive* first ("at least one cover is
a blob URL"), and only then the negative. **Assert that the feature happened
before asserting that it cannot go wrong.**

**The device had two bugs that were invisible to every other environment**, and
the first one was only found by driving the real phone:

1. An Android WebView can serve `IntersectionObserver` and **never deliver its
   initial callback** on a page that is not scrolling — measured: no callback in
   4 seconds on a visible element or on `document.body`, `requestAnimationFrame`
   firing normally, and the callback arriving instantly once the page was
   scrolled by 50px. Chromium delivers it immediately, so unit tests and desktop
   E2E could never see it. The cover cache gated fetching on that observer, so
   **no cover loaded at all** — sixteen placeholders, no error.
2. The wrapper was given `display: contents`, which gives an element no box, and
   a boxless element never intersects. It compounded (1) by removing the very
   thing the observer measures.

The general rule, and the one worth more than the two fixes: **a lazy-load gate
must be an optimisation with a guaranteed escape, never the only path to
loading.** `NEAR_VIEWPORT_FALLBACK_MS` is that escape, and the regression test
stubs an observer that observes and then says nothing — which is what the device
did.

**An effect that depends on an object which is a fresh literal on every render
re-runs on every render.** The Discover component opened with

```ts
useEffect(() => { void discover.loadWishlist(); if (hasFavourites) void discover.loadForMe(); },
  [discover, hasFavourites]);
```

`discover` is the hook's return value — a new object every render. So the effect
re-ran after *every* state change, including the `loadingMore` flag that "Show 5
more" sets. The click fetched page 2, the re-render re-ran the effect, and page 1
was fetched over the top of it. Nothing errored and nothing logged: **the button
simply did nothing, and the list never grew past five.** The dependency list now
names the stable `useCallback`s instead.

This is the third time in this project that a change was invisible because
nothing failed. The E2E caught it only because it asserted a *count* going up.

**The Vite dev server in Docker misses edits made over the `/mnt/c` bind mount.**
After fixing the effect above, the E2E still failed — against the old code.
`docker compose restart client` made it pass. `LIMITATIONS.md` §5 records this,
and it is worth repeating here because the symptom is identical to "my fix does
not work": **restart the client before concluding a client change did nothing.**

**A background worker that outlives its test fails the whole suite, not one
test.** Adding a test file shifted the scheduler enough to expose a
pre-existing race: an `EnrichmentManager` run was still updating its row after
the test that created it had torn the database down. The Prisma error escaped
as an *unhandled rejection*, so every assertion passed and `npm test` still
exited 1 — the worst kind of failure, because it looks like the code under test
is broken. `processRun` now treats P2025 ("record to update not found") as "the
run was deleted; stop quietly" and returns.

The general rule: **a suite that exits non-zero on a green run is a broken
suite**, and a background job that writes to the database must survive its
teardown.

**A module-level cache outlives `clearMocks`.** The subject-pool cache lives at
module scope, so the first test's (empty) result was served to the next three,
which then failed for reasons that had nothing to do with their assertions. The
cache now has a `clearSubjectPoolCache()` seam and the suite calls it in
`beforeEach`. Anything cached at module scope needs an explicit reset.

**A green test suite says nothing about types.** `vitest run` does not
typecheck, and no test script is wired to `tsc`. The new
`recommend-service.test.ts` imported a type that does not exist —
`EnrichmentCandidate`, when the real name is `ProviderCandidate` — and **all
eight of its tests were green** while the file did not compile. It also set a
`hasCover` field on the candidate that the provider type does not have,
because the service *derives* that from `coverUrl`; the test passed anyway
because the derived value happened to agree.

`tsc --noEmit` caught both, but only because it is a separate manual step in
this spec's verification list. It is easy to skip, and a skipped step is
indistinguishable from a passing one. **A `typecheck` script on both packages,
wired into `make test`, is the fix** — queued in `LIMITATIONS.md` §6.

The general rule: **run the type checker, and never read a green suite as
"it compiles".**

**A refinement signal that only moves things up is not tested.** Each new
ranking signal (era, next-in-series, cover present) is a *tie-breaker*, and the
failure mode is that it becomes a primary signal — turning a subject browse
into a popularity listing. A test that asserts only "the signal moves things up"
passes even when it moves them above a real tag match. There is a test for that
specifically: a real tag match must still outrank era + cover together.

## Not in this spec

Findings 2 and 6, storage management, the wordmark rename, and the dependency
security debt in `LIMITATIONS.md` §4.
