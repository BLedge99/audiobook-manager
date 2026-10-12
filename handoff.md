# Handoff — Audiobook Manager Buildout

> **Purpose:** if this session is lost, an agent (or you) can read this file to
> recover exactly where work stands. Update it at the end of every work block.
> This file is the live progress log; `roadmap.md` + `specs/` remain the plan.

## Current state (snapshot)

- Repo: `/mnt/c/Users/benle/Documents/Projects/TechNative/audiobook-manager`
- Branch: master, HEAD `6b4e861` "Fix playback resume when switching books",
  with the follow-up hardening committed on top (see "Current task").
  Owner pushes manually from their terminal.
- Spec docs exist: `AGENTS.md`, `PRD.md`, `roadmap.md`, `specs/01..13`,
  `decisions/001..006`.
- App today: Fastify + Prisma + SQLite server (`server/src/index.ts`), React
  client, docker-compose; test media in `test/` (gitignored, local only).

## Working agreement

- Implement roadmap features in order: 01 → 13.
- Each feature claims a spec; when done, update its checklist in the spec file
  and mark it done in this handoff.
- Tests are part of done-ness (spec 02 stands up the harness; features may add
  targeted unit tests as they go).
- Ask the user before deviating from spec order, restructuring infra, or when
  a product decision is needed.

## Progress log

| Item | Spec | Status | Notes |
|------|------|--------|-------|
| 01 | scanner-consolidation | **done** | single scanner module; duplicate deleted; contributor upsert fixed (name+role unique migration); releaseDate/genre ported; pure helpers in `scan-utils.ts` with 6 Vitest tests; `tsc --noEmit` clean |
| 02 | test-infrastructure | **done** | server Vitest, client Vitest+RTL (jsdom ^25 pin), Playwright root config (chromium + security projects), smoke + security placeholder E2E green. Chromium deps installed via sudo by user. |
| 03 | user-profiles-auth | **done** | buildApp() extraction, APP_PASSWORD cookie gate, Profile model + migration, profile CRUD, client LoginGate/ProfileSwitcher, 13 server tests + e2e green. **This session:** Profile.name unique (DB index + 409 handler + client error), ProfileGate forces profile pick before app renders, default profiles (Dad, Mum, Archie, Ben, Playwright, Testing) auto-seeded on first boot of an empty DB + `npm run seed:profiles` script |
| 04 | progress + listening history | **done** | PlaySession model + migration, PUT/GET progress (clamped, profile-scoped, upserted on a unique (book, profile) key), POST sessions, GET /api/history, ChapterPlayer resume/save/session flush. **Session 1:** fixed periodic 10s save (timer no longer resets on every position tick), player blocks playback with a hint when no profile is selected (was silently losing progress), resume e2e added. **Session 2 (resume bug + hardening):** client teardown/restore-seek fixes (commit `6b4e861`), then the duplicate-resume-row race eliminated server-side with a unique index + upsert, bound clamping for progress and session rows, non-numeric id validation, and a real cross-book resume E2E. 33 server tests, 10 client tests, 11 Playwright tests green |
| 05 | playback-experience | **done** | 15s skip, persisted speed, sleep timer incl end-of-chapter, auto-complete, Media Session controls, client tsc errors fixed |
| 06 | chapter-support | **done** | scanner ffprobe chapter extraction for M4B/M4A/MP4, chapters JSON stored, ChapterPlayer unified segments (tracks OR chapters OR full). NOT yet verified against a real M4B (no ffprobe on dev host; verify via docker later) |
| 07 | metadata-enrichment | **partial (audited 2026-10-12)** | Open Library + Google Books candidates, apply candidate, covers downloaded locally, scanner preserves overrides. **But:** no manual override UI exists (only the API accepts one), no confidence shown, no route tests, no Fastify schemas on metadata routes, absolute server paths leak in list/detail/metadata responses, no description trimming. `specs/07` now carries a full audit section. Remediation folded into specs 16-20. |
| 08 | pwa-packaging | **done** | vite-plugin-pwa autoUpdate SW, manifest standalone, /api NetworkOnly, dev options on, playwright manifest check. TODO: real raster icons, Lighthouse audit |
| 09 | android-wrapper | **partial** | capacitor.config.ts scaffold points at server URL; APK build blocked on Android SDK on user machine |
| 10 | lan-deployment | **done** | @fastify/static serves client/dist w/ SPA fallback, Dockerfile.prod, docker-compose.prod.yml, restart-unless-stopped, media read-only mount |
| 11 | security-hardening | **done** | safePath confinement (symlink-safe) on stream/cover, ID validation, password type check, security playwright project green, COVER_DIR env |
| 12 | ai-features | **done (MVP)** | LLMAdapter + LMStudioAdapter, /api/audiobooks/:id/ai-suggest offline-safe candidate pick |
| 13 | media-tools | **deferred (stretch)** | requires explicit user confirm + backups; not implemented yet |
| 14 | listening-position-display | **done** | `client/src/lib/position.ts` (all position maths, pure + 34 unit tests), `ProgressTimeline` (native range input + aria-hidden tick/marker overlay + chapter sub-bar, 9 tests), player readout "Track 7 — 07 - THE PREMATURE BURIAL / 13:33 into this track · 34% / 50% of the book · 2h 34m left", `/api/audiobooks` gains profile-scoped `progress`, grid "Continue listening" section. See "Current task" |
| 16 | provider-expansion | **done** | Audnexus + LibriVox clients, adaptive sequential chain (ADR 008) with METADATA_PROVIDER_ORDER override, resumable EnrichmentRun, auto-apply >=0.9 else review queue. **Live-verified** via `npm run verify:enrichment`, which found 4 bugs mocked tests could not (see below) |
| 17 | tag-taxonomy | **done** | curated 2-level genre tree (14 top-level, ~40 children) seeded at boot, GenreMapping with Misc catch-all, reconciled multi-narrator Contributor, Series with stored case-folded key + fractional position, publication facts, per-field FieldOverride precedence (ADR 009), reset + reset-all |
| 18 | favourites-custom-tags | **done** | per-profile Favourite (unique index = idempotent), household-managed Tag vocabulary with merge + reserved/genre-collision rejection. `PUT /api/audiobooks/:id/tags` is now ONE route for the whole suite (specs 17+18 originally collided on it) |
| 19 | recommendations-wishlist | **done** | external-only Discover seeded by one book or profile favourites, pure weighted tag-similarity ranking + hard dedupe on normalised title+author (ADR 010), per-profile WishlistItem with owned marker, structurally non-playable (no filePath/Track/audio route) |
| 20 | browse-discover-ui | **done** | 4 tabs (Library/Browse/Discover/Favourites), genre + series shelves, filter bar with URL state, full tag-suite editor with provenance labels, tag manager, review queue with confidence. Pure logic in `lib/browse.ts` (47 tests). **Next: roadmap 15 (GUI redesign)** |

## Bugs found by the live enrichment run (`npm run verify:enrichment`)

Unit tests with mocked HTTP could not have caught any of these; every one
silently degraded enrichment to zero results. Worth re-running against any
real library, and worth keeping the script.

1. **Scanner ignored the album tag** - multi-file books were titled after the
   folder, which for this library is an archive.org identifier
   (`12_creepytales_1206_librivox`). LibriVox and most rippers put the *book*
   title in the album tag. This was the single biggest user-visible bug.
2. **Enrichment queued nothing** - `NOT: { enrichmentStatus: 'applied' }`
   compiles to `NOT (col = 'applied')`, which is NULL (not true) for a NULL
   column, so every never-enriched book was excluded.
3. **LibriVox returns HTTP 500 when `title` and `author` are combined.** The
   client always sent both. Author is now used locally in `scoreMatch`.
   LibriVox also exact-matches titles and drops leading articles, so
   `titleVariants()` tries stripped/decoded/article-free forms.
4. **Section readers use `display_name`**, not first/last name, so narrators
   came back empty for every LibriVox title. Life spans
   ("Kara Shallenberg (1969-2023)") are stripped.

Verified result: 6 books scanned, folder names replaced by real titles
("Creepy Tales", "The Awakening", "Charles Dickens 200th Anniversary
Collection Vol. 1"), 3 enriched at confidence 1.00 with narrators and mapped
genres, 3 correctly held in the review queue.

## Environment notes (Windows dev host)

- `@rollup/rollup-linux-x64-gnu` was pinned as a direct devDependency in
  `server/package.json`, which broke `npm install` on every non-Linux host.
  Removed; rollup resolves its own platform binary.
- Prisma needs a forward-slashed `file:C:/...` URL on Windows; `file:///` and
  raw backslash paths both fail. A test's `prisma` cwd was also one level
  short of the server root.
- Temp-dir cleanup and the `symlinkSync` privilege probe no longer fail
  otherwise-green suites. One test skips without Windows Developer Mode.
- Spec 02's Docker/E2E tier still needs Docker, which is unavailable here.

## Build order after 14

**16 -> 17 -> 18 -> 19 -> 20 -> 15.** Specs live in `specs/16-` through
`specs/20-`; ADRs 008/009/010 cover the provider chain, field-level precedence,
and the recommendation engine. Item 15 (GUI redesign) moved to last so the
redesign styles the final browse surfaces instead of rebuilding them.
Item 13 (media tools) stays out of scope - media is a read-only mount by design.

## Current task

**Session 2026-10-06 (later): fixed the stale library grid.**

User-reported: listened to a book, went back to the library, and the progress
bar had not moved. Two compounding causes, both mine from spec 14:

1. **The library was never refetched.** `useLibrary` only fetched on mount and
   while a scan was running. Closing the detail modal only did
   `setSelectedBook(undefined)`, so the grid kept the `progress` values from
   page load. The server had the new position the whole time — the grid just
   never asked again.
2. **A naive refetch would have raced the save.** The player's unmount cleanup
   fires its final progress `PUT` as a fire-and-forget `keepalive` request, so
   refetching immediately after closing reads the *old* position. Fixed by
   making `ChapterPlayer` accept `onProgressSaved` and invoke it from the save's
   `.then()`, so the refetch is triggered by the write actually landing rather
   than by a guessed delay.

Fix:

- `useLibrary.refresh({ silent })` — a refetch that does not flip `loading`.
  Without this, every background refetch replaced the whole shelf with
  "Loading library..." to update one bar. The E2E asserts the placeholder never
  appears after closing.
- `ChapterPlayer` → `AudiobookDetail` → `App` thread an `onProgressSaved`
  callback, held in a ref so the unmount effect keeps its `[]` deps.
- `App` also refetches on window `focus` and on `visibilitychange` → visible,
  which covers listening that happened on another device.

Tests:

- New E2E `closing the player updates the library without a manual refresh`,
  which plays a book, closes the modal and asserts "Continue listening" appears,
  the grid never shows the loading placeholder, and the server agrees.
  **Verified it fails without the fix** (reverted the wiring, watched it fail
  with "Continue listening not found", restored) — a regression test that passes
  either way is worthless.
- Fixing this broke `resume-after-book-switch.spec.ts`: "Continue listening"
  renders a part-finished title as a heading a second time, so the spec's
  unscoped `getByRole("heading", { name: title }).click()` became a strict-mode
  violation ("resolved to 2 elements"). Fixed the helper with `.first()` and an
  `exact: true`, matching what the other two progress specs already did. The
  duplication is intended, so this is recorded in spec 14's acceptance criteria.

All green: server 38, client 53, Playwright 16 (was 15).

- `resume-after-book-switch.spec.ts` flaked once, on the full-suite run
  immediately following a `docker compose restart client` (cold Vite transform,
  so slow first paint). Three subsequent full-suite runs were clean and the spec
  passed 3/3 in isolation, so the likely cause is timing pressure from the cold
  client rather than a logic break — but it was only observed once, so treat it
  as unexplained if it recurs. `playwright.config.ts` has `retries: 1`, so a
  flake reports as "flaky" rather than failing the run.

**Earlier session 2026-10-06: spec 14 — listening position display — done.**

The server already remembered where each profile stopped (spec 04), but the UI
barely showed it: one progress bar spanning the whole book and an `m:ss` counter,
so "Chapter 4, 45 minutes in" and "38% through the book" had to be inferred by
arithmetic. The library grid showed nothing at all.

Research (Libby, Sora/OverDrive, Audible, Apple Books, Audiobookshelf) converged on
four things, all implemented:

1. **Book-level and chapter-level progress shown together, not instead of each
   other.** Audible and Audiobookshelf's Android app do this; Audiobookshelf's
   *web* player only offers one at a time and has an open request for both
   (advplyr/audiobookshelf#5440), which is why it is the differentiator here.
2. **Chapter boundaries drawn on the timeline** (Libby: "the timeline shows your
   progress, chapter breaks, ...").
3. **A marker at where this session began** (Apple Books draws "the point where
   you started listening ... marked with a gray circle"). Free here, since spec 04
   already tracks the session start.
4. **Do not rebuild the slider.** Keep the native `<input type="range">` and
   layer the decoration as `aria-hidden` + `pointer-events: none`. Recorded in
   `decisions/007-native-range-input-for-seek-control.md` so the redesign cannot
   quietly undo it.

What shipped:

- **`client/src/lib/position.ts`** — every position calculation, pure and
  DOM-free: `parseSegments`, `locateSegment`, `describePosition`, `chapterTicks`,
  `sessionMarkerFraction`, `timeLabel`, `remainingLabel`, `percentComplete`,
  `totalDuration`, `hasProgress`. 34 unit tests covering position 0, exactly on a
  chapter start, the last second of a chapter, past the final chapter, NaN,
  negative and `+Infinity`.
- **`client/src/components/ProgressTimeline.tsx`** — the native input plus the
  `aria-hidden` tick/marker overlay and the thinner chapter sub-bar. 9 render
  tests. Owns no position logic.
- **`ChapterPlayer`** — a readout line (`Track 7 — 07 - THE PREMATURE BURIAL`,
  `13:33 into this track · 34%`, `50% of the book · 2h 34m left`) and the
  session-start marker. Its duplicated local `timeLabel`/`parseSegments` were
  deleted in favour of the shared module.
- **`GET /api/audiobooks`** gains `progress: { position, completed, lastPlayed }`
  scoped to `x-profile-id`, resolved in **one** query for the whole library
  rather than one per book. Deliberately never 400s on a missing/malformed
  header, unlike `PUT /progress`: the library has to render before a profile is
  picked. 5 server tests cover that, plus profile isolation.
- **Grid** — a `Continue listening` section (most recently played first) and a
  progress line on part-finished cards in the main grid.

Deliberately **not** done, all logged in the spec's "Not in this spec":
bookmarks/highlights on the timeline (new data model), tick hover tooltips,
drag-to-scrub with a floating time bubble, and any visual polish. Spec 15 is the
GUI redesign and restyles this structure rather than rebuilding it.

Two bugs found and fixed while writing the tests:

- `locateSegment` mapped `+Infinity` to the *start* of the book while
  `describePosition` clamped the same value to the *end*. Now `+Infinity`
  clamps to the last segment; NaN and negatives still mean the start.
- `parseSegments` computed chapter duration as `end - start` with no guard, so a
  chapter whose `end` the scanner could not determine produced `NaN` and poisoned
  every later offset. Now falls back to the next chapter's start.

Validation:
- `server`: 38/38 (was 33).
- `client`: 53/53 (was 10) — 34 in `position.test.ts`, 9 in `ProgressTimeline.test.tsx`.
- Playwright: 15/15 (was 11) — new `e2e/position-display.spec.ts`.
- `tsc --noEmit` clean in both tiers.
- Live docker API confirmed: `progress` present with a profile header, `null`
  without one.

Gotcha hit during this session: the Vite dev server in docker missed the
`ChapterPlayer.tsx` edit over the bind mount and the E2E ran against stale code
(same watcher problem the older session notes describe). `docker compose restart
client` fixed it. Same applies after any client edit before running Playwright.

**Earlier session 2026-10-03: resume bug fully fixed and covered by tests.**

Continued from the previous session, which had the client-side fixes in
`6b4e861` but left the E2E failing. Everything is now green.

Root causes closed off in this session:

- **Client: the restore race had several more arms.** `ChapterPlayer.tsx` in
  this change is mostly the player hardening:
  - `userInteractedRef` — once the listener plays, seeks or picks a chapter, a
    late-arriving restore fetch can no longer override their choice.
  - `switchingSourceRef` — the synthetic `pause` from `audio.load()` is
    ignored for one tick, so swapping tracks cannot be read as the user
    pausing and cannot record a position in the track that was never played.
  - `desiredTimeRef` + `desiredTimeLockedRef` + an `onSeeked` handler — a
    cross-track seek survives the outgoing track's stray `timeupdate` and its
    `loadedmetadata`/`seeked` events. Previously an event belonging to the
    source being left consumed the pending seek, so playback restarted at the
    top of the incoming track and the saved position collapsed to that track's
    start offset.
  - `onLoadedMetadata` ignores events for a `currentSrc` other than
    `activeSrcRef`, and re-asserts a locked seek that a redundant `load()`
    discarded (React StrictMode runs the source effect twice).
  - The unmount cleanup refuses to save when a restore is still in flight and
    no session is open, and refuses to save position 0 from a player that
    never played — that combination is what wiped the stored position under
    StrictMode's mount/unmount/mount.
  - Chapter books now locate the position by range
    (`offset <= position < offset + duration`) instead of subtracting
    durations and re-adding the offset, which overshot by the offset itself.
  - Progress and session flushes are `keepalive: true`, and a
    `visibilitychange` to hidden flushes too (mobile browsers do not reliably
    fire `pagehide`, and the tab can then be frozen or discarded).
  - `flushSession` reads the rate from `speedRef` so a session records the
    speed the listener chose, not whichever value was current when the handler
    registered; the Media Session pause action now clears `shouldPlay`.
- **Duplicate resume rows (server).** `PUT /api/audiobooks/:id/progress` did
  `findFirst` then `update`/`create`. The periodic saver, the pause saver and
  the unmount saver could all observe "no row yet" and each create one, so
  `GET /progress` (which used an unordered `findFirst`) returned an arbitrary
  row and resume flip-flopped. Fixed by a DB-level
  `@@unique([mediaItemId, profileId])` (migration
  `20261005000000_listening_history_unique_position`) plus a Prisma `upsert`,
  and the read is now ordered by `lastPlayed desc`. The migration deletes all
  but the most recently played row per pair first, so it still applies to a
  database that already accumulated duplicates (verified against a synthetic
  DB with duplicates).
- **Out-of-range values persisted.** Progress is now clamped into
  `[0, duration]` only when the duration is known, and falls back to
  `max(0, value)` otherwise; a non-finite value resets to 0 instead of being
  stored. `completed` is only auto-derived when a duration exists (previously
  `0 >= 0.95 * Infinity` marked every unknown-length book as finished).
  `POST /sessions` clamps `fromPosition`/`toPosition` into the book and caps
  `speed` at 10x with a 1x fallback.
- **`GET /api/audiobooks/abc` returned 500.** `Number("abc")` is NaN and Prisma
  500s on it. It now uses `parseIdParam` and returns 400, matching the other
  id routes.
- **Deleting the active profile left the app stuck.** `ProfileSwitcher` kept
  the deleted id in state, so the profile gate never reappeared and every
  progress save was silently rejected with 400. It now reloads, like selecting
  a profile does.

Test coverage added:

- `server/src/progress.test.ts`: 8 concurrent PUTs create no extra row and the
  read-back equals one of the written values; non-numeric id → 400; session
  bounds/speed clamping and speed fallback.
- `client/src/components/ChapterPlayer.test.tsx`: no save on unmount when
  playback never started (the StrictMode mount/unmount/mount case); the saved
  position is restored to the right book; no zero re-save after restoring; a
  cross-track seek lands on the requested offset in the new track.
- `e2e/resume-after-book-switch.spec.ts` (new): the real reported scenario —
  seek book A to 3:00, play ~1s, close, play book B for ~1s, reopen A. Asserts
  the server-side position after closing A, that the B detour does not disturb
  it, and that pressing play resumes within 3m ± 30s. 300s timeout.

E2E reliability work (the previous run's "still fails" note was mostly bad
harness hygiene, not app bugs):

- `e2e/global-setup.ts` (new) + `playwright.config.ts`: fail loudly when the
  servers, the `test/` fixtures or `APP_PASSWORD` are missing, instead of
  letting every test skip into a vacuous green run. Timeout 30s → 90s, single
  worker, `serviceWorkers: "block"`.
- `e2e/helpers.ts`: `ensureAuthed()` polls the API before any helper touches it
  (a `Set-Cookie` can land after the UI re-renders, producing phantom 401s);
  `pickAnyProfile()` replaces hardcoded seeded names; `deleteProfiles()` cleans
  up leftovers and reloads so the profile gate sees the change.
- `e2e/progress-resume.spec.ts`: numeric slider comparisons (a range input over
  float offsets can fail on string-exact `1800`), books chosen by unique title
  and long enough for the seek target, `input` event only (adding `change`
  ran the handler twice), scoped heading lookups to the grid.
- `e2e/security/security.spec.ts`: shared `ensureScannedLibrary()` that reuses
  an existing library or scans a fixture path, asserts the 416 `content-range`,
  and hits real book ids so the payload tests don't pass on a 404.
- `docker-compose.yml`: sets `APP_PASSWORD` (default `household`) — the
  security suite's 401 assertions are vacuous without auth enabled.

Validation from this session:

- `cd server && npm test` — 33/33 pass.
- `cd client && npm test` — 10/10 pass; `npx tsc --noEmit` clean.
- `npx playwright test` (chromium + security) — 11/11 pass.
- Live docker server: 8 concurrent PUTs against the running API left exactly
  one `ListeningHistory` row, and the read-back was one of the written values.

Notes for the next session:

- The previous session's "browser resume test still fails" item is **closed**;
  spec 04's browser acceptance can be treated as met.
- `npm audit` (server) still reports advisories in `@fastify/static`, `vitest`
  and `esbuild`; the fixes are breaking major bumps and were left alone here.
- The compose dev server uses `prisma db push`, so `prisma migrate status`
  reports all migrations as unapplied against that database. That is expected;
  the migration matters for `Dockerfile.prod` (`migrate deploy`).
- Added trailing newlines to four files the diff had left without one.

**Earlier session 2026-10-02 (late): playback resume when switching books.**

User reports that seeking well into a book, opening another book, then returning
to the first resumes at the beginning. Reviewed this handoff, `specs/04-progress-listening-history.md`,
the progress routes, `ChapterPlayer`, and existing resume tests.

Completed in this continuation:
- Found a client-side teardown bug in `client/src/components/ChapterPlayer.tsx`:
  the unmount cleanup read `audioRef.current`, but React clears the ref before
  passive cleanup runs. The cleanup therefore skipped its final progress PUT
  when the detail modal closed/book changed.
- Changed teardown to capture the audio element while mounted and calculate
  the final position from `audio.currentTime` plus the active track offset.
  `currentIndexRef` keeps the active track index current without relying on a
  stale effect closure.
- Added a component regression test for seeking to 1800 seconds and immediately
  unmounting. Focused test passes: 3 tests in `ChapterPlayer.test.tsx`.
- Added an E2E test to `e2e/progress-resume.spec.ts` for seek to 30 minutes,
  switch to a second book, then reopen the first and verify persistence.
- Fixed another resume race: seeking before the active track's source was
  switched could be lost by `audio.load()`. Restore now defers the seek until
  metadata for the new track arrives.
- Updated React's displayed position when applying a restore seek, since
  assigning `audio.currentTime` while paused does not emit `timeupdate`.
- Prevented source changes from overwriting saved progress with zero: browsers
  can emit a synthetic `pause` while setting/loading a source, so pause saves
  now require an active listening session.
- Added an API response check to the resume E2E and a tolerance for fractional
  media duration math.

Still unresolved at the time (all closed in the 2026-10-03 session above):
- The focused browser tests still failed: although the test's direct progress
  PUT returned `{ position: 500 }`, the reopened player's slider remained at 0.
  Root cause was the duplicate-resume-row race plus phantom 401s in the
  harness, not the client.
- The server/client networking issue is resolved for tests: WSL can reach the
  API through `VITE_API_URL=http://localhost:3000`; the 401 from direct shell
  curls was expected because they omitted the household cookie.
- Temporary response logging has been removed. Spec 04's browser acceptance is
  now met.

Current validation (as of the end of that session):
- `client`: `npm test -- --run src/components/ChapterPlayer.test.tsx` — pass,
  3/3 tests.
- `get_errors` on the touched player and test files — no errors.
- `e2e`: superseded by the 2026-10-03 run (11/11 green).

Working environment:
- Backend is responding on `http://localhost:3000` (health check passed).
- Client dev server is running on `http://localhost:5173` with
  `VITE_API_URL=http://localhost:3000`; if it stops, start from `client/` in
  WSL with `export PATH=/home/benle/node/bin:/usr/local/bin:/usr/bin:/bin`
  and `export VITE_API_URL=http://localhost:3000` before `npm run dev -- --host 0.0.0.0`.
- For tests from WSL, use the clean PATH above; inherited Windows PATH entries
  contain spaces/parentheses and can break shell expansion.

**Session 2026-10-02 (evening): fixed the two user-reported bugs.**

Done this session:
- **Playback resume (issue 1).** Root causes found and fixed:
  1. With no profile selected, every progress GET/PUT got 400 and the
     client swallowed it — nothing was ever saved or restored. Fix:
     `ProfileGate` (client) now forces a profile pick (or creation)
     before the app renders, per spec 03; `ChapterPlayer` also blocks
     play with an inline hint if localStorage loses profileId.
  2. The 10s periodic save had `[playing, overallPosition]` deps, so
     the interval restarted on every position tick and never fired.
     Fix: deps `[playing]` + read position from `overallPositionRef`.
  3. (Carried over from prior uncommitted work: restore-seek race fix
     via readyState check; save progress on unmount.)
- **Duplicate profile names (issue 2).** `Profile.name` is now `@unique`
  (migration `20261002200000_profile_name_unique`), POST /api/profiles
  returns 409 on duplicates, client shows an error. Live dev DB was
  deduped (had 4× "E2E User") and the migration applied.
- **Household profiles seeded.** `server/src/seed.ts` (shared list:
  Dad, Mum, Archie, Ben, Playwright, Testing) + `npm run seed:profiles`
  script + auto-seed in `server/src/index.ts` on first boot of an empty
  DB (verified against a fresh DB). Live DB seeded.
- **Tests.** Server 29 green (new: duplicate profile name → 409).
  Client 5 green, `tsc --noEmit` clean (new: ChapterPlayer gating).
  Playwright 9 green (chromium + security). New
  `e2e/progress-resume.spec.ts` (save position via API → reopen book →
  seek bar at saved position). `e2e/helpers.ts` login() now waits for
  the gate (was racing the auth probe); added `pickProfile()` helper.
  e2e specs clean up their test profiles before AND after so runs are
  idempotent against the shared throwaway DB.
- **Specs updated:** 03 (unique names, profile gate, seeding) and
  04 (periodic-save behaviour, profile requirement) checklists.

Remaining follow-ups:
- Verify M4B chapter extraction against a real M4B via docker (no ffprobe
  on the WSL host).
- Replace SVG PWA icon with real raster icons; run Lighthouse PWA audit.
- Spec 09 APK build needs Android SDK (user machine).
- Spec 13 media tools are deferred unless the user asks for them.
- Commit + push from the user's terminal (owner pushes manually).

### Environment notes (important for a fresh session)
- No system Node: use `export PATH=$HOME/node/bin:$PATH` (Node v22.11.0, npm 10.9.0).
- Dev servers were restarted this session and are running in the
  background: server :3000 (APP_PASSWORD=household, DATABASE_URL=
  file:/tmp/audiobook-e2e.db, COVER_DIR=/tmp/covers) and client :5173
  (VITE_API_URL=http://localhost:3000). Logs: /tmp/server.log,
  /tmp/client.log. If session lost: restart both before running E2E.
- **WSL gotcha:** the vite dev server's file watcher misses edits made
  over /mnt/c — if client changes seem not to take effect, restart
  `npm run dev` in client/ before debugging the code.
- Test commands: `cd server && npm test` (38 tests), `cd client &&
  npm test` (53 tests) + `npx tsc --noEmit`, `npx playwright test`
  (or `--project=security`) from repo root. Playwright now has a
  `globalSetup` that aborts with an actionable message if the servers, the
  `test/` fixtures or `APP_PASSWORD` are missing. 16 tests as of spec 14.
- Playwright chromium system deps installed by the user via sudo.
- `e2e/` flows need the dev servers up; server DB is throwaway at
  /tmp/audiobook-e2e.db with collected sample media from `test/`.
  e2e profiles (E2E User / E2E Dup) are created and cleaned by the
  specs themselves; the six household profiles persist.

## Open questions / blockers

- None blocking. Decisions deferred to the user: Android APK build (spec 09),
  M4B verification environment, media tools (spec 13).

## Suggestions for next sessions

- **Push when ready:** the resume fix and its follow-up hardening are committed
  locally but not pushed (owner pushes manually from their terminal).
- Consider a server-side `DELETE /api/profiles/:id` guard so the currently
  selected profile can't be deleted from under the user. The client now
  reloads on delete, but other devices (or a stale localStorage) can still
  point at a deleted row and get silent 400s on every progress save.
- `npm audit` in `server/` still flags `@fastify/static` (route-guard bypass /
  non-canonical path), `vitest` and `esbuild`. The upgrades are breaking major
  bumps, so they need their own change with a re-run of the security suite.
- **Spec 15 (GUI redesign) is next.** It should restyle
  `ProgressTimeline` and `position.ts` rather than rebuild them, and
  `decisions/007` (keep the native range input) should be honoured unless a new
  ADR supersedes it. Remaining position-display ideas, in rough priority order:
  tick hover tooltips naming the chapter, a drag-to-scrub time bubble, and
  bookmarks/highlights on the timeline (the last one needs a new data model).
- `server/src/scripts/scan.ts` (package.json "scan") doesn't exist — either
  add it or drop the script (known quirk, harmless).
- If the household grows, the seeded profile list in `server/src/seed.ts`
  is the single place to edit; existing DBs won't gain new defaults until
  `npm run seed:profiles` is run manually (by design — deletions stick).

## Known bugs / quirks discovered while reading code

- `server/src/services/scanner.ts` used `prisma.contributor.upsert({ where: { id: 0 } ...})`
  (always created a new row) — **fixed in spec 01**: upsert by (name, role) + unique.
- Line endings: one commit normalized CRLF on ~30 files (cosmetic, harmless).
- `server/src/scripts/scan.ts` referenced by package.json "scan" script does
  not exist — see package.json "scan" script; never runs unless invoked.
- **Fixed this session:** progress was silently lost when no profile was
  selected (400s swallowed by the client) — now gated by ProfileGate.
- **Fixed this session:** the 10s periodic progress save never fired (its
  interval was reset by every position tick) — now keyed on `playing` only.
- **Fixed this session:** duplicate profile names were possible pre-migration;
  live DB had 4× "E2E User" — deduped, unique index applied, 409 on dupes.
- **Fixed:** `e2e/helpers.ts` login() raced the async auth probe
  (checked for the password box before it rendered) — now waits up to 3s.
- **Fixed (resume session):** concurrent progress saves created duplicate
  `ListeningHistory` rows per (book, profile), so resume read an arbitrary one
  — unique index + `upsert`, read ordered by `lastPlayed`.
- **Fixed (resume session):** `completed` was auto-set to true for every
  unknown-duration book (`position >= 0.95 * Infinity`) — only derived when a
  duration is known.
- **Fixed (resume session):** `GET /api/audiobooks/abc` 500'd via NaN into
  Prisma — now 400 via `parseIdParam`.
- **Fixed (resume session):** deleting the active profile left the client
  holding a dead id, so every progress save silently 400'd — now reloads.
- **Fixed (resume session):** E2E helper calls raced the auth cookie, so
  `page.request` calls intermittently 401'd — `ensureAuthed()` polls first.
- **Fixed (resume session):** a cross-track seek was consumed by the outgoing
  track's `loadedmetadata`/`seeked`, so playback restarted at the top of the
  incoming track — pending seeks are now source- and lock-aware.
- **Fixed (resume session):** chapter books resolved a resume position by
  subtracting track durations, overshooting by the chapter offset.
- **Fixed (resume session):** a backgrounded mobile tab lost its last seconds
  of progress — flushes are `keepalive` and also fire on `visibilitychange`.
- **Fixed (spec 14 session):** `locateSegment` mapped `+Infinity` to the start of
  the book while `describePosition` clamped it to the end — now both clamp to
  the last segment.
- **Fixed (spec 14 session):** chapter duration was `end - start` with no guard,
  so a chapter the scanner could not bound produced `NaN` and poisoned every
  later offset — now falls back to the next chapter's start.
- **Fixed (spec 14 follow-up):** the library grid never refetched after
  playback, so saved progress never appeared — the shell now refetches when the
  player's final save resolves, and on window focus / tab visible.
- **Note (spec 14 session):** the Vite dev server in docker silently misses edits
  made over the `/mnt/c` bind mount. Restart the client container before
  concluding a client change "does nothing".
- **Note (spec 14 follow-up):** a part-finished book's title is now a heading in
  two places (Continue listening + All audiobooks). Any E2E locator by heading
  name must be scoped (`.first()`, or scoped to a section) or it hits a
  strict-mode violation.

## How to resume after a dropped session

1. Read `roadmap.md` for the plan; read this file for current position.
2. `git log --oneline -5` and `git status` to see what landed.
3. Continue the "Current task" section; update this file before ending.
