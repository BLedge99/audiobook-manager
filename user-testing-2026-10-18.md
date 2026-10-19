# User testing 2026-10-18 — findings and handoff

**Verified:** all 7 findings reproduced on-device (Motorola Defy + Pixel 4a,
WebView 154–155) over Wi-Fi, real 12-book library, real listening sessions.

**Verdict from the tester:** happy, the app is in a great place, keep pushing to
perfect. None of these are blockers. They are polish and correctness.

**Status, 2026-10-19.** Findings 4, 5, 1, 3 and 7 are being worked as
[`specs/15b-post-testing-polish.md`](specs/15b-post-testing-polish.md), one
commit each, in that order. Findings 2 and 6 are deliberately not being started:
2 needs its own ADR before code, and 6 needs measuring before fixing.
**Suggested order for tomorrow** at the end of this file is superseded by that
spec. Each finding below carries its own status line.

---

**Status: FIXED and verified on device 2026-10-19** (spec 15b feature 1).
Covers are cached in IndexedDB and resolved through one `CoverImage` element on
all seven surfaces. The structural fix for "a solid colour with no placeholder"
is that an `<img>` is never handed a network URL — only a blob URL the browser
already holds bytes for, or the bundled placeholder. Cache budget is 512 MB
(~11,000 covers at this household's measured 47 KB mean).

Proven on a Pixel 4a with airplane mode on and the server unreachable, from a
cold start: **2 covers served from the device cache, 0 from the network**, and
the stored bytes decode into real artwork. Screenshot in
`specs/evidence/`.

## 1. Cover art is unstable

> "sometimes work and display, then randomly stop and go back to the
> placeholder, then other times are just a solid colour with no placeholder or
> proper cover"

**Current state:** Cover URLs come from Open Library / Google Books over the
network and are fetched live by `<img>` each render. Nothing caches them. When
the request times out or returns non-image bytes, the app falls back to the
placeholder — and because the network is a home LAN with a phone asleep, this
is intermittent, which matches the description exactly.

The "solid colour with no placeholder" is the third case the current design has
no answer for: an `<img>` whose `onError` has not fired but whose bytes are not
a valid image, or whose URL resolves but returns something unreadable.

**What a fix should do:**

- **Store covers locally on device.** The app is already a player-first shell
  (ADR 012); a cover cache in app-private storage (or a `data:` URI in
  IndexedDB) means a cover, once seen, never disappears again. This is the
  single highest-value change in this list.
- **One resolver, all surfaces.** Grid, detail, player, dock, Discover and
  wishlist all need the same cover. Today each calls out separately, so they
  each fail separately. One shared `coverFor(item)` with a single cache and a
  single fallback path is what makes the behaviour uniform and debuggable.
- **A tri-state cover element, not two.** The real states are:
  1. cached and known-good — render immediately, never refetch,
  2. cached but unverified / pending — render the placeholder *without* a
     flash of the wrong image,
  3. nothing — placeholder.
  Today the jump from 3 to 1 goes through an `<img>` that can show a broken
  frame in between, and that is the "solid colour with no placeholder".
- **Fetch efficiently and practically:** bounded concurrency, per-URL cache, and
  an `AbortController` on unmount so a fast scroll does not fire one request
  per card. Never block the grid render on the network.
- **Covers are not the artwork of the audiobook you own** (§2.7). A local cache
  makes that more noticeable, because a wrong edition then stays wrong. Worth
  stating in the fix.

**Where it is in the code:** cover resolution is spread across the server
enrichment path (`selectCoverSource` in `metadata/cover.ts`) and the client
`components/CoverArt`-style surfaces; the grid is
`client/src/components/AudiobookGrid.tsx`, the detail page
`client/src/components/AudiobookDetail.tsx`, and the dock
`client/src/components/Dock.tsx`. There is no shared cover component yet.

---

## 2. Profiles need per-user privacy

> "The profiles should have some sort of password to make reading history
> private for users, users dont want others to see what theyve been listening
> to"

**Current state:** Today there is exactly one shared household password
(spec 03, roadmap item 03). It gates the *whole app*. Every profile behind it
can see every other profile's progress, favourites, tags, Discover seed and
wishlist. There is no per-profile privacy at all.

**Why the tester noticed it:** picking a profile on a shared phone is the only
barrier, and once past it there is no boundary between Mum, Dad, Archie and
Ben.

**What a fix should do:**

- Per-profile **optional** PIN, stored as a hash (never plaintext).
- The household password still gates the app. The profile PIN gates the
  *profile*. Two levels, and the second is the privacy boundary.
- **Profile switcher locks back to the household gate**, or shows a per-profile
  prompt — never exposes one profile's library to a different profile.
- Biometrics: **fingerprint on Android** is the one that will be in the house.
  Capacitor's `Biometrics` plugin (or a native wrapper) can unlock a stored
  token. FaceID is explicitly not a requirement (§3: nobody in the household owns
  an Apple device), and passkeys need a relying party — a server URL on a LAN —
  which is more machinery than a household wants.

**Real constraint to respect:** biometric unlock must never be a hard gate.
The app must always allow the PIN fallback, and must never store the password
in a way a stolen phone can exfiltrate. This is the one item on the list that
should not be started casually.

**Where it is in the code:** `client/src/components/ProfileGate.tsx`,
`server/src/app.ts` auth hook, `specs/03-user-profiles-auth.md`,
`specs/11-security-hardening.md` (auth-model constraints).

---

## 3. Discover is flaky and spams results

> "it servers no results for a while, then suddenly spams results, it needs
> work to find more similar matches and shouldnt serve infinite results at
> random, for example maybe display top 5 at a time, then allow a 'load more'
> button"

**Status: FIXED 2026-10-19** (spec 15b feature 3). Five at a time with a "Show 5
more" button; the server pulls two provider pages per subject, **ranks the merged
pool once and then slices it**, so page 2 continues page 1 instead of being a
fresh draw. Ranking gained published-decade proximity, next-in-series and
cover-present signals, all small enough that a real tag match still outranks
them. Provider calls now identify themselves (3x the Open Library rate limit),
carry an 8s deadline, and are cached for 30 minutes — and a failed page is never
cached, so an outage cannot blank Discover for half an hour.

**Current state:** After the 2026-10-18 fix (ADR 010 amendment,
`searchOpenLibraryBySubject`) it does return results. But it has all three
problems the tester described, and they are worth naming precisely:

- **Flaky:** Open Library subject search is a live external HTTP request. A
  slow or rate-limited response makes the whole tab show "nothing found", and
  a fast one makes it look full. There is no cache, so the same seed re-hits
  the API every time the tab opens.
- **Random:** `subject:fiction` is an enormous set — thousands of works — and
  `search.json` returns them in Open Library's own order, not ranked by
  relevance to *your* seed. The local ranker re-orders, but it is ordering a
  pool that was itself picked at random. That is exactly "results at random".
- **Infinite:** `limit=12` per subject × 3 subjects, returned all at once.
  There is no pagination, no top-N, no "load more".

**What a fix should do:**

- **Top 5 at a time, with a "Load more" button.** This is the right shape.
  Keep a cursor into the subject pool; append the next 5 on demand.
- **Better similarity, not just more results.** The ranker
  (`rankCandidates` in `metadata/recommend.ts`) currently compares genre
  slugs and author names. It could weight **series proximity**, **era /
  published-decade proximity**, and **narrator** for audiobook-native
  sources. Anything that makes the top 5 look *curated* rather than
  alphabetical.
- **Cache the subject pool** per seed so the tab is instant on second open
  and no longer depends on Open Library answering in that moment.
- **Be honest about what a subject browse is.** It is a browsing primitive
  wearing a recommender's clothes, and §1.8 already says the results are print
  books. A "load more" button that returns yet more random popular fiction is
  not obviously better than a curated 5. Decide which one is wanted.

**Where it is in the code:**
`server/src/metadata/recommend-service.ts` (`expand`, `forProfile`),
`server/src/metadata/recommend.ts` (`rankCandidates`, `buildSeed`,
`searchTermsFor` — the last is now dead weight after the fix),
`server/src/enrichment.ts` (`searchOpenLibraryBySubject`),
`client/src/components/Discover.tsx`,
`e2e/library-browse.spec.ts` (the new "favouriting books actually produces
suggestions" test).

---

## 4. Refresh leaves the library empty for about a minute

> "The refresh button seemed very slow, after pressing it made the app show as
> nothing in library for around a minute before repopulating library"

**Status: FIXED 2026-10-19** (spec 15b feature 4). Rows stay on screen with a
"Refreshing..." indicator, requests coalesce, the library refetches once a
profile is picked, and `GET /api/audiobooks` answers 304 — measured at 56,717
bytes down to 0 for a refresh that changed nothing.

**Current state:** This is a known and now-measured behaviour, not a mystery.

- `useLibrary` fetches `/api/audiobooks` whole and filters client-side
  (§5, §2.6 "Server-side search"). A full-library GET on a slow LAN is the
  only refresh trigger that is not already debounced.
- **The real cause is the empty window:** the refetch clears the current
  library before the response arrives, so for the whole round-trip the grid
  shows "nothing in library". The app looks broken for exactly as long as the
  request takes, which on a waking phone over Wi-Fi can be a long time.
- It is worse now than before the redesign (§1.7): the dock and "Continue
  listening" are the first thing on the Library tab, so an empty grid reads
  as "you have nothing in progress" rather than as a fetch that has not
  returned.

**What a fix should do:**

- **Never show an empty state for a refetch that already has data.** Keep
  rendering the stale rows and show a small "Refreshing" indicator instead.
  Only an *initial* fetch with no data is allowed to show "nothing".
- **Debounce / coalesce** the trigger so a double-tap or a background fetch
  plus a manual tap cannot stack.
- **Consider a `?since=` or `if-none-match` path** so a refresh returns only
  what changed. The library is read-only on the device (ADR 012), so a
  changed-since response is cheap to produce and turns a 1-minute refresh
  into a 200ms one.

**Where it is in the code:** `client/src/hooks/useLibrary.ts` (the fetch and
the empty-state logic), `client/src/components/LibraryGrid.tsx` /
`AudiobookGrid.tsx` (the render), `client/src/components/RefreshButton.tsx`.

---

## 5. The player should be at the top of the book page

> "The player for books should be at the top rather than below a load of info
> like tags etc, the most common reason for opening a book is to play it, so
> the media player should be front and center at the top of the screen"

**Status: FIXED 2026-10-19** (spec 15b feature 5). The player now sits directly
under the title, with favourite / find-more-like and a one-line fact strip
below it; series, description, tags and the online metadata lookup are behind a
"Book details" fold. The mobile cover was also capped at 120px, because the
dialog stacks on one column and a 270px cover pushed the transport below the
fold. Spec 14's position display was reused, not rebuilt, and the duplication
this exposed — series and description were being printed twice, once as prose and
once inside the Details panel — is gone.

**Current state:** The detail page currently renders metadata — tags, series,
contributors, enrichment status, review-queue actions — above the player.
The tester's instinct matches ADR 012's whole thesis: **the device is a
synchronised player, not a second library manager.** The book page currently
leads with the library-manager half.

**What a fix should do:**

- **Player first, always.** On a phone, the first screen of a book should be
  cover + title + a real player: play/pause, seek, speed, next/prev.
- **Metadata below, in a fold.** Tags, series, contributors, narrator,
  description and review-queue actions belong on the page, but below the
  player, and collapsed by default where possible. They are rare touches, not
  the reason anyone opens a book.
- **Respect what spec 14 already shipped.** The position display (chapter +
  position in chapter + book % + time left + chapter ticks + session-start
  marker) is the *good* half of the player and must not be regressed. The
  redesign already reused spec 14's `position.ts` and `ProgressTimeline`; the
  same care applies to the reorder.
- **The dock and "Continue listening" already embody this on the Library tab**
  (spec 15). The book detail page should be consistent with it.

**Where it is in the code:** `client/src/components/AudiobookDetail.tsx`
(the current top-to-bottom order),
`client/src/components/ChapterPlayer.tsx` (the player itself),
`client/src/lib/position.ts` (the position maths — pure, tested),
`client/src/components/ProgressTimeline.tsx`.

---

## 6. Lock-screen controls are slow

> "The lock screen controls worked but were fairly unresponsive, sometimes
> taking well over a second to register."

**Current state:** Background audio is provided by a foreground service
(spec 26 Phase 1 spike, §1.4) and is already verified to keep playing with the
screen off. The *controls* (play/pause, skip) go through that service's
notification, and the user-visible symptom is a >1 second tap-to-effect gap.

**What a fix should do:**

- **Measure it first.** §5 already records two false diagnoses in this exact
  area ("a CDP timeout means the phone dozed"; "a probe must exercise the same
  code path as the failing feature"). Confirm the delay is in the
  notification-media-session path and not a general phone doze.
- **Route taps through a handler that updates local state immediately** and
  reconciles with the service, rather than waiting for the service to confirm.
- **Pre-warm the MediaSession** so a tap on a cold lock screen does not pay a
  cold-start cost.

**Where it is in the code:** the foreground service registration
(`client/android/app/src/main/...` service class, or the `MediaSession`
Capacitor plugin config), `server/src/plugins` media routes,
`client/src/components/ChapterPlayer.tsx`, and
`capacitor.config.ts` (`MediaSession` plugin entry).

---

## 7. The copy needs a full review

> "Much of the wording and descriptions are very poorly written, a complete
> review of all text, hints and other text instructors/labels in the app is
> worthwhile, perhaps a skill exists to help with this."

**Current state:** There is no single place that owns the app's voice. Copy is
written inline across ~20 components and has never been reviewed as a whole.
The redesign (spec 15) introduced a lot of new copy in one pass, and the
tester is right that it reads inconsistently.

**What a fix should do:**

- **One voice, one register.** Pick a register (warm, plain, brief — not
  corporate, not jokey) and apply it everywhere. The capsule world is
  friendly; the copy should be too, without being cutesy in operator screens.
- **A single copy table.** A `copy.ts` / `strings.ts` keyed by surface, so a
  text change is a one-line edit rather than a component hunt. It also makes
  the review auditable in one sitting.
- **Review every surface**: the gates (offline, no-server, no-library),
  tabs, detail, player, settings, review queue, tags, shelves, grid, plus
  every button label, tooltip, aria-label, empty state and error message.
- **A skill does exist for this.** `impeccable` is available and is explicitly
  for UX copy, information architecture, typography and clarity. It is the
  right tool for the bulk pass.
- **Do it last of the seven,** after the structural changes, so the copy
  review does not fight the layout moves at the same time.

**Where it is in the code:** everything under `client/src/components/`,
`client/src/ui/primitives.tsx` (the shared `Btn`, `Notice`, `StatusTag`,
`Field` components carry most of the default labels), and
`client/src/lib/api.ts` (error messages surfaced to the user).

---

## Where this sits against the existing plan

| Finding | Existing spec / ADR | Notes |
|---|---|---|
| 1 Covers | spec 23, §2.7 | New: local cache + shared resolver + tri-state |
| 2 Profile privacy | spec 03, spec 11 | New level; biometrics are the hard part |
| 3 Discover | spec 19, ADR 010 | Fix exists; needs pagination + better ranking |
| 4 Refresh | §1.7, §2.6 | Known; now measured and user-visible |
| 5 Player first | ADR 012, spec 14, spec 15 | Reorder, don't rebuild |
| 6 Lock screen | spec 26, §1.4 | Audio works; controls lag |
| 7 Copy | spec 15 | New; `impeccable` skill is the right tool |

**Suggested order for tomorrow:** 4 (small, high-visibility), then 5
(also small), then 1 (biggest real gain), then 3, then 7. Leave 2 (profile
privacy + biometrics) for a dedicated session — it is the only one that
deserves its own ADR before code is written.

**That order was adopted and is now the build order** for
[`specs/15b-post-testing-polish.md`](specs/15b-post-testing-polish.md), with
finding 2 left out as advised. One correction to this document while working
through it: the paths named above are `client/src/useLibrary.ts` and
`client/src/components/RefreshButton.tsx` — there is no `hooks/` directory, and
the refresh control is an `IconBtn` in `App.tsx`, not its own component.
