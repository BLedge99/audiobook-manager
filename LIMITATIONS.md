# Known limitations and planned work

A single place to record **what does not work yet**, **why**, and **what to do
about it**. Written 2026-10-13 against `master` @ `ff0e600`.

**Updated 2026-10-18** with 1.6 and 1.7, both found during device testing of the
spec 15 redesign and both verified against the running stack rather than
inferred. Every claim below was verified against the running stack or the live
provider APIs, not inferred from reading code. Where a number is given, it is
measured.

**Updated 2026-10-19** to reconcile this file with what actually shipped, and to
record the polish pass now under way in
[`specs/15b-post-testing-polish.md`](specs/15b-post-testing-polish.md). Two
claims here turned out to be stale and are corrected below: §1.4's first-run
dead end is fixed, and §1.7's missing post-profile refetch is being closed as
the first feature of the 15b pass. Everything else is unchanged.

Status legend: **BROKEN** = does not work · **LIMITED** = works, but narrower
than intended · **DEFERRED** = deliberately not built.

---

## 1. Broken

### 1.1 Google Books is completely non-functional
**Status: BROKEN — needs a key.**

`GET https://www.googleapis.com/books/v1/volumes` returns `{"error": ...}` from
this host. `searchGoogleBooks` then returns `[]` silently, so half the provider
chain has been doing nothing at all.

The mapping code is **written and unit-tested** — `mapGoogleVolume` extracts
`categories`, `publisher`, `publishedDate`, `industryIdentifiers`, `language`,
`description` and `imageLinks`. Only the credential is missing.

```bash
# server/.env
GOOGLE_BOOKS_API_KEY=<key from console.cloud.google.com>
```

**Why it matters:** Google Books is the richest source for publisher, ISBN and
categories, and it covers books Open Library has no edition of. Expect the
biggest single jump in coverage from this one line.

### 1.2 Audnexus book metadata is never applied
**Status: BROKEN — architecturally blocked.**

`AudnexusProvider.search()` and `bookByAsin()` exist and are unit-tested, but
`resolveProviderOrder()` excludes `audnexus`, so `runChain` never calls them.
The only live Audnexus call is `chaptersByAsin()` for chapter titles.

This was intentional in ADR 011: Audnexus has **no book-search endpoint**. It
only answers about an ASIN you already hold. See §2.1 for why that is a dead
end.

### 1.3 `npm run scan` is a broken script
**Status: BROKEN — trivial.**

`server/package.json` declares `"scan": "tsx src/scripts/scan.ts"`, but
`server/src/scripts/scan.ts` **does not exist**. Running it fails. Use
`make scan` instead, which drives the API correctly and waits for completion.

Either add the file or delete the script entry.

### 1.4 The Android app cannot work away from home
**Status: MOSTLY FIXED (2026-10-14, reconciled 2026-10-19). Downloads, offline
playback and first-run setup all work; only the storage-management UI is
missing.**

Sprint 2 has landed. What now works, verified on a Pixel 4a:

- **Auth.** The WebView is cross-site relative to a plain-HTTP API, so Chrome
  drops the `SameSite=Lax` cookie. Login returns the session token in the body
  and the server also accepts it in `x-house-session`; the cookie path is kept
  for the browser/PWA. Requests the browser issues itself (`<audio src>`,
  `<img src>`) carry the token in the query string, because a media or image
  element cannot send a header.
- **Download.** `@capacitor/file-transfer` writes each track with real progress.
  A full 5-track book downloaded and every file matches the server's
  `Content-Length` **byte for byte**.
- **Cover art** and **layout** at phone widths (guarded by
  `e2e/phone-layout.spec.ts`).

Still broken:

- ~~**First-run is a dead end.** `needsServerUrl()` has no call site, so
  `ProfileGate` blocks the only route to Settings and a new user cannot enter a
  server address. This was the most user-visible remaining bug.~~
  **Corrected 2026-10-19 — this is fixed.** `needsServerUrl()` is called at the
  top of `App`'s render (`client/src/App.tsx`), so the server-URL screen is the
  first thing a new install sees and `ProfileGate` is never reached without a
  server to fetch profiles from. The claim above was true when written and was
  not re-measured before being quoted here.
- **Downloaded audio is invisible.** `Directory.Data` is app-private: no file
  manager can see, free or delete downloaded books. ADR 012 accepted this; for a
  household app it is probably the wrong trade.
  **Note (2026-10-19):** the household removed the storage-management work from
  the polish pass, so this remains an unmet spec 26 acceptance criterion rather
  than a scheduled one. It is recorded in §3 as deferred.

**Offline playback — reported working, not yet independently verified.** On
2026-10-19 the user confirmed from daily use that downloaded books download and
play offline. That is a human report from real listening, which is stronger
evidence than a spike, but it has not been re-verified against the spec 26
manual checklist (airplane mode, seek, screen off) on a second run.

**Sprint 1 is complete** and it de-risked the two things that could have changed
the architecture. On a Pixel 4a / Android 13:

- Audio **does** keep playing with the screen off, and seeking works — but only
  behind a real foreground service. The web `navigator.mediaSession` API on its
  own gave *no* media notification and *no* lock-screen controls, because there
  was no service behind it. That is why Capacitor is being used at all, and it
  is now settled: `@capgo/capacitor-media-session` with
  `foregroundService: "always"`.
- The `server.url` problem is already fixed — it was removed, so the app serves
  its own bundled assets instead of trying to load `localhost:3000` (which on a
  phone is the phone, not the home server, and loaded nothing).

What remains is Sprint 2: download to the device filesystem, `convertFileSrc`
seeking, Dexie for metadata, and an in-app server-URL setting.

**Known trap:** a truncated MP3 reports the *full* file's duration while holding
only part of the audio, so seeking past its real end stops playback permanently
and Play cannot recover. This looked like an app bug during the spike and was
not. Use complete files from `test/`.

### 1.5 Listening progress is last-write-wins and can silently regress
**Status: BROKEN — data loss.**

`PUT /api/audiobooks/:id/progress` accepts any position, so a stale or buggy
client can overwrite a bookmark that is hours further ahead — with no warning.
The concrete failure: a phone dies offline at 1h 30m, another device listens to
2h 14m, the phone reconnects and pushes its older position.

Fixed in `specs/26-android-app.md`: progress becomes **monotonic** — forward
pushes apply silently, a backward move beyond 5 minutes is blocked and surfaced
as a conflict for the user to resolve, and an explicit `allowRewind` flag exists
for the deliberate case. Because the rule is monotonic, clock skew stops being a
correctness problem.

---

### 1.6 The Android WebView would not reach a home server by LAN address
**Status: FIXED and verified on a cable-free device — 2026-10-18.**

A Pixel 4a with `com.google.android.webview` **154.0.8037.106** refused every
`fetch` from the app to a LAN address. Measured, from inside the app's own
WebView:

| Target | Result |
|---|---|
| `http://localhost:3000` (via `adb reverse`) | `200`, ~40ms |
| `http://192.168.1.203:3311` (same machine, LAN IP) | `TypeError: Failed to fetch`, **1ms** |

**How it was diagnosed, because it was not what it looked like.** The instinct
was a port, a firewall or a CORS problem. All three were ruled out by
measurement: the phone pings the host at 0% loss, the host serves `200` on the
same port from `127.0.0.1`, the phone's own OS stack gets `200 OK` from the LAN
address over `nc`, the CORS preflight returns `204` with the right origin, and
`cleartextTrafficPermitted` is already `true`. A 1ms failure is a local browser
decision made before any packet left the device.

The cause is **mixed content**. Capacitor serves the app from
`https://localhost`, a secure context, so every plain-HTTP request to the home
server is blocked by the renderer. `http://localhost` is exempt under the URL
standard's "potentially trustworthy origin" rule, which is exactly why the
original `adb reverse` setup worked and a real Wi-Fi client never did. **The app
worked over USB for a reason unrelated to how anyone actually uses it.**

**Fix — two changes, not one.** `server.androidScheme = "http"` in
`capacitor.config.ts` so the app is served from `http://localhost` and a LAN
address is same-scheme rather than mixed content. **And** `http://localhost`
added to the server's CORS allow-list, because the scheme change moves the app's
origin and CORS compares the origin whole.

> **The second change is the one that mattered, and it is invisible when missed.**
> With only the scheme change the app *still* failed, in 21ms, exactly as before.
> The renderer reports a CORS rejection to `fetch()` as a bare
> `TypeError: Failed to fetch` — no mention of CORS in the message, the console
> warning, or the promise. The two settings are coupled and the coupling is
> silent, so both origins are now allowed and both are asserted in
> `server/src/app.test.ts`.

The full reasoning, the alternatives rejected (including
`Access-Control-Allow-Private-Network`, a plausible-sounding explanation that is
*not* the mechanism) and the security trade are in
[`decisions/014-webview-http-scheme.md`](decisions/014-webview-http-scheme.md).

**Why it mattered most of anything in this file:** the product's deployment *is*
"the phone reaches the home server by IP". Every documented setup path assumed
that worked, and it did not.

**One consequence to expect:** the origin changes from `https://localhost` to
`http://localhost`, which is a different origin, so an existing install loses its
stored server URL and profile and shows the server-URL screen once. That is
expected — not a deleted profile.

**Verified** on a **Motorola Defy, Android 11, WebView 155**, over Wi-Fi with
`adb reverse --list` confirmed **empty** so nothing masked the network path:
`/api/health` → `200` in 44ms, `/api/audiobooks` → `200` in 27ms, and a
screenshot showing 12 real titles with real covers. The Pixel 4a has not been
re-tested against the fix; the Defy's WebView is newer, which is the harder
case.

### 1.7 The library is fetched before a profile exists, so progress is stale on arrival
**Status: FIXED (2026-10-19) by spec 15b feature 4.**

**Was:** `useLibrary` fetched `/api/audiobooks` once at mount, before the
household password or a profile had been chosen, so the response carried no
`progress`. After `ProfileGate` succeeded nothing refetched; the only refetch
triggers were window `focus` and `visibilitychange`. A listener who opened the
app, picked a profile and started browsing saw no progress bars and no
"Continue listening" until they left and came back.

Pre-existing, but the redesign made it far more visible: the dock is now the
first thing on the Library tab, so an empty dock reads as "you have nothing in
progress" rather than as a fetch that has not happened yet.

A second symptom was reported the same day: pressing refresh showed "nothing in
library" for around a minute. Measured cause: the refetch cleared the current
library before the response arrived, so the grid rendered its empty state for
exactly as long as the request took — a long time on a waking phone over Wi-Fi.

**What shipped (spec 15b feature 4), measured against the live stack.**

- `loading` is true only until the first response has ever arrived. A refetch
  keeps the rows on screen and shows a "Refreshing..." status beside the library
  heading; only an initial fetch may say "nothing".
- Concurrent triggers share one in-flight promise, so the focus handler, the
  visibility handler, the scan poller and a manual tap can no longer stack
  requests.
- The library refetches when a profile is selected, so progress is present on
  arrival rather than after the next trip out of the app.
- `GET /api/audiobooks` and `/api/library-roots` answer `304` to a matching
  `If-None-Match`: **56,717 bytes → 0 bytes** for a refresh that changed
  nothing. See [`user-testing-2026-10-18.md`](user-testing-2026-10-18.md) item 4.

### 1.8 Discover suggests **print** books, not audiobooks
**Status: BY DESIGN, and the reason is provider reality. Found 2026-10-18.**

Discover now returns real recommendations, which it never did before (see the
amendment in [`decisions/010-recommendation-engine.md`](decisions/010-recommendation-engine.md)).
But it draws them from Open Library, which catalogues print editions. Every
suggestion therefore has **no narrator and no runtime**, and may describe a book
with no audiobook edition at all.

The UI labels each card `BOOK — NOT AN AUDIOBOOK YET` rather than letting a cover
imply something playable. This is a real constraint, not a rendering nicety:
**there is no free, key-less service that returns audiobook-to-audiobook
similarity.** Audnexus resolves audiobooks by ASIN only, with no search; LibriVox
matches titles exactly, so it cannot answer "what else is like this".

So the wishlist, not the suggestion, is the load-bearing part of this feature: it
remembers a title worth hunting down, and "mark as owned" closes the loop when it
turns up as an audiobook.

**If this needs to change,** every option is paid or account-bearing (Hardcover's
GraphQL recommendations, or Audible's own catalogue). That is a product decision,
not a bug.

---

## 2. Limited

### 2.1 There is no way to obtain an Audible ASIN
**Status: BLOCKED — verified, no free route.**

Audnexus is ASIN-keyed, and the fixture commercial library carries **no ASIN
anywhere** — not in filenames, not in tags, not in MP4 atoms, including a
real `inAudible`-encoded M4B.

Every route tested and rejected:

| Route | Result |
|---|---|
| Audnexus `/books?title=` | 404 — endpoint does not exist |
| Audnexus `/authors?name=` | returns only `asin` + `name`; no book list |
| Audnexus `/authors/{asin}` | returns `asin, description, genres, image, name, region` — still no books |
| Open Library editions | `isbn_10` / `isbn_13` only; **no ASIN** |
| Apple iTunes | returns `collectionId`, not an ASIN; no narrator field |
| Embedded atoms | absent from the fixture M4B |
| Audible's own search | requires a signed request with a fixed private key — fragile and against their terms, which is what Audnexus exists to avoid |

**Consequence:** Audnexus can never be reached for a library without ASINs.
Keep the provider ready (region fallback, failure observability) but do not
build an ASIN resolver.

### 2.2 Enrichment is not deterministic
**Status: LIMITED — inherent.**

Two consecutive forced `make enrich` runs over identical media gave
**applied 10 / review 1** and then **applied 8 / review 4**. Nothing is cached
between runs; which providers answer varies per run, and LibriVox/Open Library
race for some books.

Treat published coverage numbers as a **range**, not a state. Two books are
*consistently* in review, and both are correct:

- **Creepy Tales** — best match is *"Twelve Creepy Tales"*, a different book
- **Short Ghost and Horror Collection 034 / 052** — exact LibriVox title
  matches that intermittently lose the provider race

Adding `GOOGLE_BOOKS_API_KEY` should reduce this by giving the chain a third
independent opinion.

### 2.3 Narrator coverage is 8/12 and capped by what files carry
**Status: LIMITED.**

Narrators are resolved locally (spec 24) in order: `composer` atom → `comment`
field (`Read By X`) → bracketed folder name (`{Stephen Fry}`). There is **no
online fallback**, because none exists:

- Open Library / Google Books / Apple iTunes: no narrator field — they catalogue
  the *work*, not the *recording*
- Audnexus: has narrators, but ASIN-gated (§2.1)
- LibriVox: has real `readers`, but only for public-domain titles

The two unresolved commercial books carry no narrator in any tag or folder
name. **This is the correct outcome, not a gap to close.** The spec 17
tag-suite editor is the intended manual answer.

### 2.4 Series coverage is 6/12 and may be at its ceiling
**Status: LIMITED.**

Series is read from Open Library, gated: only when no provider supplied one,
and only with both a name and a usable position. Several commercial sets simply
have no series data upstream. This may not be improvable without Audnexus.

### 2.5 Language is often empty on purpose
**Status: LIMITED — deliberate.**

Open Library merges every edition of a work, so `language` arrives as the set
of languages the book was *ever* published in — Harry Potter returned
`["gre","urd","arm","vie"]`. Taking the first would file an English audiobook
under Greek, so a **strict winner** is required and a four-way tie yields
nothing. Empty is the honest answer there.

### 2.6 Descriptions are fetched lazily and only from Open Library
**Status: LIMITED.**

Search results carry no blurb, so a description needs a second request per book.
It fires only when neither the candidate nor the book already has one. Only
Open Library work records are consulted; a Google Books description is used
directly when present.

### 2.7 Cover art comes from book catalogues, not the audiobook edition
**Status: LIMITED, and now user-visible (2026-10-18).**

Covers resolve independently of the title winner (spec 23), which fixed the
LibriVox case. But the sources are cover *editions* from Open Library or Google
Books thumbnails — not the artwork of the specific audiobook you own. You may
get a different edition's jacket.

**User-reported symptom, 2026-10-18:** covers display, then randomly revert to
the placeholder, and sometimes render as a solid colour with neither placeholder
nor artwork. Measured cause: cover URLs are fetched live by `<img>` on every
render with **no cache anywhere**, so a slow or failed LAN request drops the
card back to the placeholder. The third case — a solid colour with no
placeholder — is the design's missing tri-state: an `<img>` whose bytes are not
a valid image and whose `onError` has not yet fired.

A local cache would fix the first case outright (a cover, once seen, never
disappears) and would make the second permanent rather than intermittent, which
is why it is the top cover task in
[`user-testing-2026-10-18.md`](user-testing-2026-10-18.md) item 1.

**Decision taken 2026-10-19 (spec 15b):** both halves are implemented. The
server sends `Cache-Control: private, max-age=86400` and an `ETag`, so the
browser and PWA revalidate instead of refetching; and the device keeps a
persistent IndexedDB cover cache so a cover survives airplane mode in the
Android shell, where a service worker is not available.

**The cost, stated plainly:** caching makes a wrong cover *sticky*. Before, a
failed fetch at least left the placeholder as an honest "we don't have this";
now the wrong edition persists until the `ETag` changes. That is the trade the
15b spec accepts, and it is worth knowing when a cover looks like a different
edition's jacket.

### 2.8 Auto-apply has a judgement call in it
**Status: LIMITED — deliberate, and reviewable.**

The floor was lowered from 0.9 to 0.7, but with a guard: in the 0.7–0.9 band
the **author must agree**, because `scoreMatch` is ~85% title-weighted and a
bare floor drop auto-applies books by the wrong author.

The exception is an **exact title match**, which is what recovers LibriVox
collections (provider records "Various" where the file tags a narrator). That
exception is a judgement call, not a requirement — it is in
`shouldAutoApply` and easy to revert.

An explicitly requested threshold via the API is still honoured literally.

### 2.9 Contributor sets are replaced wholesale
**Status: LIMITED — known risk.**

`reconcileContributors` **replaces** a book's contributor set. If one provider
supplies one narrator and another supplies five, last write wins and one set is
silently discarded. Not observed to bite in the fixture library, but it is a
correctness risk if Audnexus is ever wired in alongside a catalogue provider.

### 2.10 `MediaItem.asin` exists but is never written
**Status: DORMANT.**

The column is in the schema and nothing populates it. ASIN extraction is
filename-only, and only at enrichment time. Writing it at scan time would make
Audnexus reachable permanently rather than incidentally.

---

## 3. Deferred

| Item | Why |
|---|---|
| **Spec 13 — media tools** | Out of scope by decision. Media is a read-only mount; writing tags into user files is not wanted. |
| **Downloaded-books list and "Remove from device"** | An unmet spec 26 acceptance criterion: Settings shows a byte total and a count, but no list and no way to free a book from the UI. Removed from the 15b polish pass by the user on 2026-10-19; recorded here so it is not lost. `useDeviceLibrary.remove()` and `Settings` already exist — it is a UI, not a feature. |
| **Per-profile privacy (PIN + biometrics)** | Finding 2 of the user testing. Needs its own ADR before any code: a new auth level, a schema change and a biometric path, with spec 11's auth-model constraints shaping it rather than following it. |
| **Spec 15 — GUI redesign** | The only roadmap item with **no spec file at all**. Needs `specs/15-*.md` written first. Now sequenced **after** spec 26, since restyling a shell that is about to be wrapped in an APK would mean restyling it twice. |
| **Chapter/track title editor UI** | Spec 24 shipped the `PUT /tracks/:trackNumber/title` endpoint and the `FieldOverride` storage, but **no UI**. A hand-set narrator/track title is only reachable via API. |
| **Bookmarks & highlights** | Needs a new data model. Deliberately out of spec 14. |
| **PWA raster icons / Lighthouse** | Placeholder SVG icons only; a Lighthouse PWA audit has never been run. |
| **Search relevance ranking** | Results keep library order. Fuzzy matching, stemming and scoring are a separate feature. |
| **Server-side search** | The library is fetched whole and filtered client-side. A `LIKE` query would add a second source of truth. |
| **iOS** | Explicitly not a requirement; nobody in the household owns an Apple device, so it could not be tested. |
| **Offline editing / enrichment / scanning** | Deliberately server-only. The device holds a read replica; see ADR 012. |
| **Download queues / whole-library sync** | Deliberately out of scope for spec 26 — one book at a time over the LAN. |
| **Play Store publishing** | Sideloaded APK is acceptable for a household. |

---

## 4. Security debt

`npm audit` in `server/` reports **12 advisories (2 critical, 6 high, 4
moderate)**. Client is clean (0).

| Package | Severity | Issue |
|---|---|---|
| `tinypool` | **critical** | Prototype pollution gadget in worker options → RCE |
| `vitest` | **critical** | via `@vitest/mocker` |
| `@fastify/static` | high | Authorization bypass via non-canonical URL paths |
| `fastify` | high | DoS via unbounded memory allocation in `sendWebStream` |
| `find-my-way` | high | DDoS with HTTP2 |
| `music-metadata` | high | Infinite loop in ASF parser |
| `vite` | high | Path traversal in optimized deps `.map` handling |
| `source-map-js` | high | Event-loop DoS via indexed source-map offsets |
| `@vitest/mocker` | moderate | Path traversal / arbitrary file read |
| `esbuild` | moderate | Dev-server cross-origin requests |
| `vite-node` | moderate | — |
| `file-type` | moderate | Infinite loop in ASF parser |

**Assessment:** most are dev-time (`vitest`, `vite`, `esbuild`, `tinypool`) and
do not ship in the production image. The two that matter are
**`@fastify/static`** (auth bypass — it serves the built client in
`Dockerfile.prod`) and **`music-metadata`** (infinite loop on a malformed ASF
file, reachable from the scanner on untrusted media).

All fixes are breaking major bumps, so they need their own change with a
re-run of the security E2E suite. **Not started.**

---

## 5. Developer-experience friction

- **E2E requires WSL + Docker.** `scripts/e2e-wsl.sh` provisions a Linux Node
  because WSL ships none and the Windows interop `npm` installs `.cmd` wrappers
  bash cannot execute. Docker is unavailable from the Windows shell.
- **WSL idles out and reaps the containers.** Any sequence of
  "start stack → query → inspect" must run in a **single** WSL session or it
  fails with connection errors that look like code bugs.
- **The Vite dev server in Docker misses edits made over the `/mnt/c` bind
  mount.** `docker compose restart client` before concluding a client change
  "does nothing".
- **E2E helper gotchas.** `ensureAuthed` does a *relative* `fetch` and fails
  with "Failed to parse URL" unless a `goto` has already run. `pickAnyProfile`
  waits for the "All audiobooks" heading, which only exists on the Library tab,
  so entering on `?tab=browse` times out inside the helper.
- **PowerShell mangles nested quotes** in `wsl -e bash -lc "..."`. Write a
  script file and invoke it instead.
- **A `fetch` to an unreachable host does not always fail — it hangs.** Found
  2026-10-21, on the Pixel 4a, with the server genuinely unreachable.
  A stale DHCP address on a network that blackholes packets never sends a RST,
  so the request sits in CONNECT for tens of seconds.

  The app's **reachability probe had no timeout**, so `serverReachable` stayed
  `undefined` and the app sat on the splash showing "Connecting…" for good.
  That is precisely the case the offline path exists to handle: the point of
  downloading a book is to listen to it with no network, so a server that
  cannot be reached must never be a screen the listener cannot leave.

  Fixed with `client/src/lib/reachability.ts` (a bounded probe, 10s) and
  `client/src/lib/api.ts` (`boundedFetch`, 30s by default, now used by the
  library and browse hooks). **Every request in the app should eventually go
  through `boundedFetch`** — the per-component `request` helpers in
  `ReviewQueue`, `TagManager`, `AudiobookDetail` and the gates still use a raw
  `fetch`, and each of them can still spin forever when the server is
  unreachable.

  A second, smaller race came with it: the app decided "offline" before the
  **device library** had finished loading from IndexedDB, so a phone with
  three downloaded books could be told it had nothing to play. The splash now
  waits for the device library too.

- **A promise that rejects while nothing is listening is an unhandled
  rejection**, and Vitest reports those as errors that fail the whole run — so
  attaching `expect(promise).rejects` *after* the thing has already rejected
  turns a green suite red. The handler has to be attached first.

- **A green suite that exits non-zero is a broken suite, not a flaky test.**
  Found 2026-10-19 while adding a test file to the server suite. Every
  assertion passed and `npm test` still exited 1, because a background
  `EnrichmentManager` run outlived the test that created it, tried to update a
  row its teardown had deleted, and the Prisma error escaped as an **unhandled
  rejection**. The trigger was a *new test file changing the scheduler* — the
  race was always there and nothing had perturbed it. `processRun` now treats
  P2025 as "the run was deleted; stop quietly".

  The general rule: **a background job that writes to the database must survive
  its teardown**, and a non-zero exit from a green run has to be chased down
  rather than re-run until it goes away.
- **A module-level cache outlives `clearMocks`.** The Open Library subject-pool
  cache lives at module scope, so the first test's result was served to the
  next three tests, which then failed for reasons unrelated to their
  assertions. Anything cached at module scope needs an explicit reset seam and
  a `beforeEach` that calls it.
- **An effect that depends on a hook's return object re-runs every render.**
  Found 2026-10-19: the Discover component listed `discover` — a fresh object
  literal on every render — in its dependency list, so "Show 5 more" re-fetched
  page 1 over the top of the page it had just appended. **Nothing errored and
  nothing logged; the button simply did nothing.** Depend on the stable
  `useCallback`s, not on the object they come back in. See the 15b spec's
  trap notes.
- **Neither `npm test` nor `make test` typechecks.** `vitest run` does not
  typecheck, and no test script is wired to `tsc`. A test file that imports a
  type which does not exist **passes the whole suite** and only fails
  `npx tsc --noEmit` — which, being a separate manual step, is easy to skip.
  Found 2026-10-19 when `recommend-service.test.ts` imported a
  `EnrichmentCandidate` that is actually called `ProviderCandidate`; all 8 of
  its tests were green and the type error was invisible until `tsc` ran.

  The 15b verification checklist *does* include `npx tsc --noEmit` for every
  feature, so the process catches it — the harness just does not enforce it.
  **A `typecheck` script on both packages, wired into `make test`, is the
  obvious fix** and is queued in §6. Until then: run `tsc` yourself, and
  remember that a green test suite says nothing about types.
- **`handoff.md` contains two stale mentions** of "owner pushes manually" inside
  dated 2026-10-02 session entries. They are an accurate record of those
  sessions and are intentionally left.
- **Android SDK installers stall on Windows.** `winget` sat at 0 bytes and the
  Android Studio installer froze on a GUI prompt. Plain `curl` of the
  commandline-tools zip worked at ~10 MB/s. Do not reach for an installer GUI.
- **An unplugged phone looks exactly like a broken USB driver** (found
  2026-10-19, while starting the spec 15b cover-cache device pass).

  `adb devices` listed **nothing at all**, which reads as "the cable is
  charge-only" or "USB debugging is off". `Get-PnpDevice` showed the device
  twice, `Android Composite ADB Interface`, both with `Status = Unknown`.

  **The cause was that the phone was disconnected.** The user had taken a call
  and unplugged it. Windows keeps the device nodes around and reports them as
  `Unknown`, and `adb` simply lists nothing — so "Unknown" does **not** mean "no
  driver started", which is what it was first read as. Re-plugging was the whole
  fix; the driver, despite being dated 2014, was never at fault.

  The lesson worth keeping is the order of checks, not the diagnosis:
  **ask whether the phone is actually plugged in and unlocked before theorising
  about drivers.** Then, if it really is connected and still invisible, compare
  the instance IDs from `Get-PnpDevice` against the `USB_Install` lines in
  `android_winusb.inf`; if the IDs are missing, the driver genuinely is too old
  and binding a current one needs an **elevated** shell:

  ```powershell
  pnputil /add-driver "$env:LOCALAPPDATA\Android\Sdk\extras\google\usb_driver\android_winusb.inf" /install
  ```

  Wireless debugging is the alternative and needs no driver at all — the phone
  and PC are on the same home network anyway, which is how the app itself
  reaches the server.
- **An Android WebView can serve `IntersectionObserver` and never call it back**
  (measured on a Pixel 4a / Android 13, 2026-10-19).

  An observer on an element that was demonstrably on screen — 161×235 at
  `top: 388`, inside a visible card — **never delivered a callback in 4
  seconds**, and neither did one on `document.body`.
  `requestAnimationFrame` fired normally, so the rendering pipeline was alive.
  Scrolling the page by 50px made the callback arrive immediately. Chromium,
  which the unit tests and the desktop E2E suite run on, delivers the initial
  observation pass straight away, so **nothing about this was visible anywhere
  except on the device.**

  Consequence here: the cover cache gated its fetching on that observer, so on
  the real phone **no cover was ever fetched** — sixteen placeholders, no error,
  and an E2E test that passed because it only asserted that no image pointed at
  the network, which is trivially true when nothing loads at all. The fix is a
  deadline (`NEAR_VIEWPORT_FALLBACK_MS`). **A lazy-load gate that can silently
  prevent all loading is worse than no gate at all.**
- **`display: contents` gives an element no box, and a boxless element never
  intersects.** The cover wrapper was given `display: contents` to avoid an
  extra layout box, which silently disabled the observer above. The rule: **an
  element that is observed must have a real box**, and `className="contents"` on
  one is always a bug.
- **Do not drive this WebView by tapping coordinates.** `adb shell input tap` on
  the server-URL field did not focus it at all (`mServedView=null`,
  `mInputShown=false`), and a mistimed tap pulled down the notification shade
  instead. Drive the page over the Chrome DevTools Protocol, and assert on *what
  the page is holding* — `document.querySelectorAll('[data-cover] img')` and
  their `src` — which is more reliable than a screenshot and is the actual claim
  under test.

  ```bash
  adb forward tcp:9222 localabstract:webview_devtools_remote_$(adb shell pidof com.technative.audiobookmanager)
  curl -s localhost:9222/json    # then connect to webSocketDebuggerUrl
  ```

  **Pass the JavaScript to the harness in a file, never as a command argument.**
  Every expression contains quotes and a space, and PowerShell's argv quoting
  split them into nonsense like `Failed to parse URL from
  http://127.0.0.1:Evil/.test(x.innerText)`.
- **Capacitor 7/8 needs JDK 21.** An older JDK fails `assembleDebug` with an
  unhelpful Gradle error. `JAVA_HOME=C:\Tools\jdk21` in the build script.
- **PowerShell `>` corrupts binary output**, so `adb exec-out screencap` produces
  an unreadable file. Use `cmd /c adb ... > file` for raw bytes.
- **`adb exec-out screencap` returns black while the display is dozing**, so the
  lock screen itself cannot be verified by screenshot. Ask the user, or assert on
  `dumpsys` instead.
- **Never rebuild or reinstall while the user is mid-test.** It looks exactly
  like playback spontaneously dying. Say what you are about to push.
- **A CDP timeout means the phone dozed, not that the code failed.** The WebView
  suspends with the screen, `adb forward` to the devtools socket then hangs, and
  the result looks identical to a hang in the app. Check
  `dumpsys power | grep mWakefulness` before concluding anything. This caused
  two false diagnoses.
- **Verify what is *installed*, not what is on disk.** `npm run build:android`
  runs `tsc -b && vite build`, so a type error means the bundle is silently
  **not** rebuilt and `cap sync` copies the previous one. Always confirm the
  asset hash or `dumpsys package | grep lastUpdateTime` changed.
- **Vite serves a stale transform on this bind mount.** After editing a module
  the dev server can keep serving the previous version, so a correct fix looks
  like a no-op and tests fail at an identical number. Clear it with
  `docker compose exec client rm -rf node_modules/.vite` and restart.
- **A probe must exercise the same code path as the failing feature.** Calling
  `window.Capacitor.Plugins.FileTransfer` directly proved downloads worked while
  the app's own button did nothing, because the app loaded the plugin through a
  different, broken path. That mismatch cost more time than any other mistake
  here.
- **Gradle cannot delete `build/` or `app/build/` while its daemon holds it.**
  `gradlew --stop`, then remove the directory, then assemble. This is the
  equivalent of `clean` and is what the "never skip clean" rule was protecting.

---

## 6. Suggested order of work

Scope changed on 2026-10-13: the household must be able to listen away from
home, so the Android app became the top priority and displaced the GUI redesign.

> **Superseded 2026-10-18, and now reconciled 2026-10-19.** On 2026-10-18 the
> app was tested by a second household member on a second phone. Seven findings
> came back; all are reproduced, none are blockers, and the tester's verdict was
> that the app is in a great place. They are in
> [`user-testing-2026-10-18.md`](user-testing-2026-10-18.md) and are now being
> worked as [`specs/15b-post-testing-polish.md`](specs/15b-post-testing-polish.md).
>
> **What shipped underneath that, and is no longer work:** spec 26 Phase 1 (the
> foreground service de-risk spike), spec 26 Phase 2 (download to the device
> filesystem, Dexie replica, cover URLs in the shell), the `http` WebView scheme
> fix (§1.6), the in-app server-URL screen (§1.4), and the Discover enrichment
> fix of 2026-10-18. What is left of the old list is carried into the list
> below rather than dropped.

**Current order — the 15b polish pass, five features, one commit each:**

> **Reconciled 2026-10-21, after feature 7 landed.** All five are done. What
> remains is the per-profile library membership that was planned alongside it,
> and then the two findings that were deliberately left out.

1. ~~**Refresh must never blank the library.**~~ **DONE** — `235aa28`. Close
   §1.7, plus coalescing and a `304` path. Small, and the most immediately
   visible defect a household hits.
2. ~~**Player first on the book page.**~~ **DONE** — `35316d5`. A reorder
   against ADR 012's thesis, reusing spec 14's position maths rather than
   rebuilding it.
3. ~~**Cover cache and a tri-state cover.**~~ **DONE** — `4a7df3c`, fixed
   `fb19435`. The largest real gain: server cache headers plus a
   device-persistent IndexedDB cache and one shared cover element across all
   seven surfaces. **On-device pass done** (Pixel 4a, airplane mode, cold
   start: 2 covers from cache, 0 from network).
4. ~~**Discover: five ranked suggestions and "Show 5 more".**~~ **DONE** —
   `cb28038`. Pagination *and* ranking together, with a provider pool cache and
   a request timeout. The pool is now ranked **once** and sliced, so page two
   continues page one.
5. ~~**Copy review into `client/src/copy.ts`,** with impeccable `clarify`.~~ **DONE.**
   Every user-facing string is in one table, split into a **listener** tier and
   an **operator** tier, with a build-failing guard against the system's own
   vocabulary in the listener's copy. The rule it turned up is in
   `PRODUCT.md`: *a heading, an explanation or a hint must say why the listener
   is there and what they can do, in their terms — not what the system is
   doing.*

**Then:**

6. **Per-profile library membership** — roadmap item 27,
   [`specs/27-per-profile-library.md`](specs/27-per-profile-library.md).
   New profiles start empty; existing profiles are migrated to contain every
   book, so nobody's library changes on upgrade. A separate "All books" tab;
   removing a book offers to delete its download too. The 512 MB cover cache is
   deliberately untouched by it.
7. **Per-profile privacy (PIN, optional biometrics).** Finding 2. ADR first.
8. **Lock-screen control latency.** Finding 6. Measure before fixing — §5 records
   two false diagnoses in this exact area.
9. **Track title / narrator editor UI** — makes the spec 24 endpoint reachable
   by a human (§3).
10. **Downloaded-books list and "Remove from device"** — unmet spec 26 criterion,
    removed from the polish pass on 2026-10-19.
11. **Add `GOOGLE_BOOKS_API_KEY`** — one line, largest enrichment gain (§1.1).
    Still waiting on the user; the mapping code is written and tested.
12. **Fix or delete the `scan` script** — two minutes (§1.3).
13. **Write ASIN at scan time** — makes Audnexus reachable if such files ever
    appear (§2.10).
14. **Contributor merge rules** — needed before Audnexus is ever wired in (§2.9).
15. **Dependency upgrades with a security E2E re-run** — §4.
16. **Spec 26 Phase 0** — the `LibraryStore` read-model seam. Server-only, no
    user-visible payoff, so it is reviewed on its own.
17. **Add a `typecheck` script to both packages and wire it into `make test`** —
    five minutes, and it closes the gap where a test file with a broken import
    passes the entire suite (§5). `vitest run` does not typecheck, and
    `npx tsc --noEmit` is currently a manual step that is easy to skip.