# Spec 42 — Re-audit remediation: the 2026-11-16 review

> **Status: done 2026-11-16.** Written from the 2026-11-16 architecture
> re-audit (`architecture-review-2026-11-16-1147.html`, fresh-context explore).
> Every phase below is executed and merged to master. Read "How to work this
> plan" before starting anything.

## Purpose

The re-audit of the tree after spec 41 closed found the same failure shape
emerging in the newest code (the week's wake/SW work), one pre-existing hole in
the GDPR self-service path that nobody noticed, and one broken public-document
surface on the production demo. This plan closes all nine re-audit candidates
plus the production privacy-notice blank page, preserving the outlines of spec
41's discipline.

## Scope

Nine candidate cards from the re-audit (2026-11-16) plus the out-of-band
privacy-notice defect, mapped to phases:

| Phase | Audit card(s) | Outcome |
|---|---|---|
| 0 | — | Baseline: suites/build/typecheck green on master, report filed; number of phases and steps accepted by user |
| 1 | 1 (+B1, A4) | The wake budget has one home and a resolver-backed contract; WakingServer's Retry button lives again; wake flow is tested |
| 2 | 2 (+A1-un guarded) | swUpdate.ts never reloads mid-playback; precached-shell first-ever-visit-offline behaviour pinned |
| 3 | 3 | GDPR self-service (`/api/me/export`, self-erasure, `/api/me` PATCH) works in the household deployment; the `boundedFetch`-bypass class closed via construction, not discipline |
| 4 | 3 (addition) | **The production privacy notice at `/privacy` renders in every state** — online, server-waking, and precached-shell-offline |
| 5 | 4 | specs/29, specs/30 and decisions/020 document the `srv-<hash>/` on-disk layout; spec-of-record matches code |
| 6 | 5 | useBrowse's coalescer mint does not mint-per-profile-generation; profile switch no longer races the previous run's landed state |
| 7 | 6 | One shelf-scope default spelling at every site, pinned by one helper |
| 8 | 7 | `ui/primitives.tsx` prunes the three dead exports, gains direct tests for the absorbing surfaces, and stops being a non-leaf; the t-*/EmptyPanel convergence is either enforced or dropped |
| 9 | 8 | Family listener refuses a broken dist the same way the admin does; admin status no longer advertises a CORS allow-list it does not enforce |
| 10 | 9 | Demo-vs-household predicate joins `local/kids.ts` (or a recorded decision not to) |
| 11 | — | Docs, spec/plan bookkeeping, final verification |

Out of scope:

- Anything spec 41 already closed (the nine cards of that plan) — re-verify their
  landed state, do not reopen.
- The waking-server design (ADR/spec 29 shape) itself; this plan does not change
  PROBE semantics, the SW contract, or the offline gate's shape.
- Rewriting auth, session, profile-policy or crypto logic.
- New dependencies or frameworks.
- CSS redesigns of any surface; visual redesign is out.

## How to work this plan

1. **Test first, observed failing**, then the implementation. If you cannot make
   the test fail for the right reason, the test is wrong — fix the test.
2. **One step per commit**, named in the commit message.
3. **The tree is green at the end of every step.** `make test`, both typechecks,
   and the bundle budget must pass.
4. **Do not start a phase whose predecessor is not merged**, except that phases
   1, 3/4, 5 and 8 are mutually independent.
5. **Phase 4 interacts with Phase 1/2** — the client-side `/privacy` path must
   render correctly while the server is waking, or the fallback still lies.
6. Every phase ends with a named verify command; run it.

---

## Phase 0 — Baseline

**State on entry:** master at the re-audit commit. **Files:** none (read-only).

0.1 Run `make test` (or the machine-local v20 invocation if the containerised
    stack cannot boot in this environment); record suite counts and durations.
    0.2 Run `npm --prefix client run build` and the bundle budget script.
    Record numbers here when the plan closes.
    0.3 The re-audit report itself stays in %TEMP%; do not commit it. Record the
        file name in the plan bookkeeping step.

**Definition of done:** green tree, numbers recorded, no code changes committed.

---

## Phase 1 — The wake budget, extracted and tested (audit card 1)

> The largest defect the re-audit surfaced: this week's cold-start/wake work is
> written three times in three incompatible forms, with zero unit coverage, and
> a broken Retry button in the UI whose only purpose is to say "try again".
> This phase extracts the budget into one module and gives the wake surface tests.

**Files:** `client/src/lib/wakeBudget.ts` (new), `client/src/lib/wakeBudget.test.ts`
(new), `client/src/lib/useSession.ts`, `client/src/components/WakingServer.tsx`,
`client/src/components/ChapterPlayer.tsx`, `client/src/lib/useSession.test.ts`,
`client/src/components/WakingServer.test.tsx` (or extension of App.test).

### Step 1.1 — one module owns the wake budget

**Test first** (`wakeBudget.test.ts`): `FAST_PROBE_MS === 10_000`,
`WAKE_TIMEOUT_MS === 75_000`, `WAKE_BACKOFF_MS` is the exact tuple
`[1_000, 3_000, 8_000, 20_000, 45_000]`, and the ladder's total spend is at
least the patient probe's budget (the invariant the audit flagged as
"roughly" written). No `isWithinWakeBudget` helper: nothing calls it, and
speculative API is how the wake budget fragmented in the first place.

**Then:** create `lib/wakeBudget.ts` exporting the three constants and the test
contract. `reachability.ts` and `useSession.ts` import from it; `ChapterPlayer`
imports the backoff tuple.

### Step 1.2 — useSession unblocks Retry during its own probe

**Test first:** simulate the patient probe failing; assert that a user's tap on
"Retry" while the first wake probe is in flight **still enqueues a probe** — the
`probeInFlight` guard must accept explicit `force: true` and cancel-then-replace,
or the Waking screen Retry button stays a no-op.

**Then:** `useSession.probeServer` takes explicit `force`; if a wake probe is in
flight and the user forces another, cancel the inflight one (AbortController
intra-module) and run a fresh one.

### Step 1.3 — WakingServer is tested, not just painted

**Test first:** render `WakingServer`, tap "Retry", assert `wakeBudget.test`
links it re-entering the probe path. (Or verify it calls a UI-retry callback
that is wired — not "cannot observe a network call from jsdom, but React
render-slots / probe-call spy suffice.")

**Then:** wire Retry through the callback used by App; the button does what it
says.

### Step 1.4 — the player's stream retry ladder composes the same module

**Test first:** `ChapterPlayer` still mounts and plays; the backoff constants
come from `wakeBudget`; a stream failure later in a chapter triggers the same
probe ladder, not a separate one.

**Then:** wire `WAKE_BACKOFF_MS` from `wakeBudget`; delete the local constant;
typecheck confirms. While wiring this, fix the defect the test exposes: the
load effect resets the ladder on *every* run — including the reload each
rung schedules — so the give-up path was unreachable; reset the ladder only
when the resolved source changes identity.

**Verify:** `make test-client` → `make test`. **Definition of done:** one source
of truth; WakingServer's Retry starts a real re-probe; the wake path has
coverage; the wake ladder cannot reset itself mid-climb.

---

## Phase 2 — swUpdate does not evict a listener's playback (audit card 2)

**Files:** `client/src/swUpdate.ts`, `client/src/components/ChapterPlayer.tsx`
(export a narrow `isPlaying` signal or use a tiny event bus),
`client/src/components/DownloadButton.tsx` (existing role model).

### Step 2.1 — the reload is gated on idle playback

**Test first:** a fake `controllerchange` while `playing == true` does NOT
reload; while `paused` it does; while `ended` at least one path clears the
"hold" signal so a never-pause book can still take the swap.

**Then:** `swUpdate.ts` listens for the playback signal the ChapterPlayer emits
on pause/end/buffer-empty (or a single `window` property / event-emitter): the
reload is delivered **at the earliest audible pause point**, never mid-chapter.

### Step 2.2 — the precached-shell first-ever-visit-offline is pinned honestly

**Outcome (2026-11-16):** pinned in LIMITATIONS §2.12 — a first-ever visit
without a network is an ordinary failed network request showing the browser's
error page; there is deliberately no offline fallback page in this plan,
because that is a product decision (vite `navigateFallback`). The config-test
route was rejected — asserting `navigateFallback: null` pins a definition,
not a behaviour. Repeat visits, the normal case, are unaffected.

**Verify:** `make test-client` → `make test`. **Definition of done:** a
`controllerchange` mid-chapter does not interrupt listening; what the offline
first-visit path does is pinned, honest, and documented in LIMITATIONS.

---

## Phase 3 — the GDPR self-service actually works in the household (audit card 3)

**Files:** `client/src/components/AccountMenu.tsx`,
`client/src/lib/request.ts`, `client/src/components/ProfileRegistration.tsx`,
`client/src/components/DeviceUnlockSettings.tsx`, `client/src/components/ProfileGate.tsx`,
`client/src/components/Settings.tsx`, `client/src/lib/passkeys.ts`,
`server/src/request-context.ts` (nothing modified; only read).

### Step 3.1 — the request guarantee gets one path, or the bypass is gone

**Test first:** `AccountMenu`'s export button returns a real payload (not 400)
after sign-in in household mode; the same call wired by hand with
`boundedFetch` + `x-profile-id` also works (parallel control).

**Then:** every direct `boundedFetch` that targets `/api/me…` or any
profile-scoped path is routed through `request()`/`requestRaw()` so the
session-headers guarantee is structural — or the bypass itself is deleted
where it cannot be justified with one line.

### Step 3.2 — the same bypass class is swept narrowly

**Test first:** enumerate the profile-scoped endpoints hit by any current
component; every one resolves with the profile header; the grep-sweep for
`boundedFetch(` under `client/src` stays green.

**Then:** convert the remaining call sites use `ProfileGate`, `ProfileRegistration`,
`DeviceUnlockSettings`, `SessionSettings`, `passkeys`, `useAccountGate`. Keep the
blast radius: only routes carrying personal data (Art. 4(1)) or session state
(live-session data). A non-personal request (`/api/health`, `/api/config`) is
out of scope and legitimately stays on `boundedFetch` if unavoidable.

**Verify:** `make test-client` → `make test`. **Definition of done:** household
`/api/me/export` returns 200 with data; self-erasure returns 200; the sweep
test pins the class of bypass shut.

---

## Phase 4 — the production privacy notice is reachable always (audit card 4, user addendum)

**Files:** `server/src/routes/static.ts`,
`client/package.json` / `vite.config.ts` (verify the SPA has no `/privacy`
route; it does not),
`client/src/lib/privacyNotice.ts` (extend, or add client route),
`client/src/App.tsx`,
`specs/GDPR-privacy-notice.md`,
`specs/GDPR-data-subject-rights.md` (link the two if both claim the same),
`e2e/privacy-notice.spec.ts` (new).

### Step 4.1 — diagnosis: why blank white page, not the notice

**Diagnosis (confirmed 2026-11-16):** the report was correct and the mechanism
is cold, hot, and precached alike: the SPA has no `/privacy` route. In dev,
Vite's fallback served the shell (blank). In prod, the SW's document rule
(NetworkFirst, 4 s timeout, cached-shell fallback) hands the browser the
shell whenever the network cannot answer inside the timeout — the Render
free-tier wake path. The server route itself works (`curl → 200 text/html`);
the shell path never reaches it. First-ever-visit-offline is the browser
error page (LIMITATIONS §2.12).

### Step 4.2 — the notice is reachable with the server cold

**Outcome:** landed 2026-11-16. `client/src/pages/PrivacyNotice.tsx` renders
the notice with zero network dependency (a fetch-stubbed test proves it);
`main.tsx` lazy-imports it on `/privacy` (9.9 kB chunk, ~3.2 kB gzip, precached
— the app chunk stays flat at 289.6 kB); `client/src/lib/privacyPath.ts` owns
the pathname decision (four pinned cases). Verified live: dev stack renders
`Privacy notice — Audiobook Manager` at `/privacy`, no console errors.

### Step 4.3 — the notice is reachable with the server asleep

**Outcome:** the fallback chain is now SW NetworkFirst → cached shell →
in-app route → lazy chunk (precached) — the notice renders with the server
waking, asleep or absent. Asserted at unit level (component has no network
dependency); the server-owned copy remains reachable for direct navigation
(`curl /privacy` → `200 text/html`). `check:copy` exempts the legal document
via the new `scanIgnorePaths` in `scripts/check-copy.mjs` (file-scoped, the
same dialect as `ignoreKeys`), recorded here and not silently.

### Step 4.4 — one responder for /privacy, decided in one line in the spec

**Decision (2026-11-16):** the server document wins when the network answers
(SW NetworkFirst returns it as-is); the in-app copy is the fallback for the
cached-shell case and the canonical copy in dev. Two copies, one structure —
pinned by `PrivacyNotice.parity.test.ts` (section anchors; load-bearing
sentences) and recorded in `specs/GDPR-privacy-notice.md` §2b. Verify in
prod: cold/waking server, navigate to `/privacy` — notice visible; hot
server — server document byte-identical to pre-change output.

**Verify:** `make test-client`; `make test`; manual verification against prod.

**Definition of done:** privacy notice is visible to the person reading it
whether the server is hot, cold, or asleep; GDPR Art. 12(1) legible in all three
states; spec GDPR-privacy updated; `LIMITATIONS` noted if the same fallback is
required for other public documents (none currently).

---

## Phase 5 — spec-of-record catches up with the code (audit card 4)

**Files:** `specs/29-offline-resilience.md`, `specs/30-offline-library-per-server.md`,
`decisions/020-offline-shelf-per-server.md`.

**Test first:** grep across `specs/`, `decisions/`, `LIMITATIONS.md` for the
pre-fix layout string `books/<bookId>/`; each of those three files, at most one
sentence about the location of downloaded audio on disk gains the one-paragraph
fix or points to spec 41 (`srv-<hash-16>/<bookId>/`).

**Then:** land the three sentences (or the cross-reference). spec 30 documents
the layout; spec 29 documents the adoption rule (files remain in-place under
the originating shelf); decisions/020 copies the two sentences behind an
addendum "spec 41 completed the file layer".

**Definition of done:** `rg 'books/<bookId>' specs/ decisions/` hits nothing
except historical text; the three documents cite spec 41/ADR-020 for the current
truth.

---

## Phase 6 — the coalescer per profile (audit card 5)

**Files:** `client/src/useBrowse.ts`, `client/src/lib/coalesceRefresh.ts`,
`client/src/useBrowse.test.tsx`.

**Test first:** simulate profile switch mid-refresh; the previous refresh's
resolved `setFavourites(ids)` does not overwrite the new profile's heart set;
or the stale generation's final `setFavourites` is dropped on mount-version
mismatch.

**Then:** `useBrowse` keeps the coalescer in a ref, one per hook instance
(mint once, not per `useMemo` epoch), and refuses to let the old epoch write
through after the profile changes (a mount-version counter suffices).

**Verify:** `make test-client` → `make test`. **Definition of done:** hearts are
never written across profiles mid-switch; one regression test pins it.

---

## Phase 7 — one shelf scope at every call site (audit card 6)

**Files:** `client/src/local/replica.ts` (new helper or co-export beside
`replicaBookKey`), `client/src/lib/api.ts`, `client/src/components/AudiobookGrid.tsx`,
`client/src/components/Shelves.tsx`, `client/src/components/AudiobookDetail.tsx`,
`client/src/components/ChapterPlayer.tsx`, `client/src/local/useDeviceLibrary.ts`,
`client/src/lib/useSession.ts`, `client/src/lib/request.ts`-adjacent internals
and related unit tests.

**Test first:** `shelfScopeOf("a", undefined) === "a"; shelfScopeOf(undefined, id)`
is the project default; the JSX-key sites produce React keys in the same
`<serverId>#<id>` spelling the DB rows use.

**Then:** introduce one `shelfScopeOf(...)` (name taken from GLOSSARY's
"shelf") used for defaulting in every site touched by spec 41 Phase 9.2 plus
any other `serverId ??` default. The composite-key spelling is then spelled
exactly once throughout the tree.

**Verify:** `make test-client` → `make test`. **Definition of done:** `grep -c
'serverId ??' client/src` returns zero outside the helper itself.

---

## Phase 8 — the absorbing primitives earn direct tests; the absorption pass
             and/or decide against enforcing it (audit card 7)

**Files:** `client/src/ui/primitives.tsx`, `client/src/ui/primitives.test.tsx`,
`client/src/ui/SessionStatus.tsx` (if exist), `client/src/lib/check-copy.mjs`
(only if the absorption was worth enforcing — decide inside the phase),
`client/src/components/Discover.tsx` (possibly convert its empty state to
`EmptyPanel` or explicitly not, with the same decision applied to the Icon
EmptyPanel used in the empty discover body).

### Step 8.1 — prune dead exports

**Test first:** after pruning, no client reference to `Panel`, `STATUS`,
`StatusKey`, `StatusDot`, `shellTint` remains (compile-time check); measured
export count of `primitives.tsx` drops; the direct tests must still cover
every export that a call site imports.

**Then:** delete the three dead exports; run the suite.

### Step 8.2 — direct tests for the absorbing surfaces

**Test first:** `Notice` (role="status" while not alert; alert only when
`tone=error`; class table); `EmptyPanel` (children render), `Btn variant="glass"`
(class table round-trip for one edge case), `Backdrop`/`CloseButton` (click
handler resolves); `PageHead` (title, intro); `MachineMark` renders the mark.

**Then:** land the suites.

### Step 8.3 — the two spellings of "small quiet text" pick one

**Decision (2026-11-16): keep the mixed spellings, deliberately.** The four
t-\* classes name *specific* sizes (0.78125/0.71875/0.75/0.84375 rem); the
~100 remaining `text-[…]` values across 23 files are real, different sizes
(0.6875, 0.8125, 0.875, 1.0625 …). Converging them repaints the type scale —
a visual redesign this plan excludes — and minting one class per size is
class inflation with no caller discipline behind it. No gate is added for
the same reason: `check:copy`'s scan has no whitelist mode for "arbitrary
but legitimate Tailwind", so a regex rule would only teach people to
suppress it. The t-\* classes remain the default for the four sizes they
name; the audit's EmptyPanel case was audited in detail — the wishlist row
uses `EmptyPanel` and Discover's big-icon empty state (Compass mark plus
prose, the common case on a fresh install) is the intentional second
library, kept as is.

### Step 8.4 — ui/primitives.tsx stops being a non-leaf

**Test first:** no import from `../local/` in `ui/primitives.tsx`; the file
size drops. `ShellCover`'s dependency on `local/CoverImage` either moves
`ShellCover` to `local/` or the injected-`bookCoverKey` interface is kept,
documents, and tested at the boundary (not internal call-resolution).

**Then:** `ShellCover` moves (or the injectable decision is landed); the
module's only imports are `react`, `copy.ts`, `clsx`, `../local/*` (no local
into *leaf-level*; `../local/*` is fine only for `CoverImage`/`db` surfaces
that are composed, not resolved at construction).

**Definition of done:** dead exports gone; direct tests for Notice, EmptyPanel,
Btn glass, Backdrop, CloseButton, PageHead all green; `ShellCover` lives in one
or the other module with a single interface; the small-quiet-text decision is
documented.

---

## Phase 9 — family and admin listeners absorb the shared seam honestly (audit card 8)

**Files:** `server/src/shared/listener.ts`, `server/src/app.ts`,
`server/src/admin/app.ts`, `server/src/shared/listener.test.ts` (extensions).

**Test first:** the family listener's `registerClientDist` rejects a `distDir`
without `index.html` (before the routes register), matching the admin's behaviour;
the shared module's `SHARED_CORS_ORIGINS` (if surfaced to the admin status route)
is labelled "family" or dropped from the payload together, so the admin UI does
not claim what it does not do.

**Then:** make `requireIndexHtml: true` the default in the shared helper (or pass
it in both call sites — either is fine); drop or rename the admin `corsOrigins`
field honestly; the shared module's `routeDocs` remains thin but gains no
consumer-specific private seam.

**Verify:** `npm --prefix server test`; `make test`. **Definition of done:** the
family/admin startup behaviour differs only by the documented product surface,
not by an accident of `requireIndexHtml`; the admin panel no longer advertises
a CORS allow-list it never enforced.

---

## Phase 10 — the demo-vs-household question gets one answer (audit card 9, conditional)

**Files:** `client/src/local/experience.ts` (new, or `kids.ts` renamed), every
site that compares `accountExperience === "demo"` (`App.tsx`, `GateList`,
`api.ts`, `useAccountGate.ts`, `EmailForm.tsx`, `useSession.ts`, `profiles.ts`),
`client/src/local/experience.test.ts` (or `kids.test.ts`).

**Test first:** `isDemoExperience(accountExperience)` is true for `"demo"`,
false otherwise, fail-closed on unknown/undefined the same way the server does.

**Then:** replace the 13 call sites with the same predicate used in the kids
sweep; add a render-sweep test (parallel to `kidsSurface.test.tsx`) — or, if
the volume of the rename defeats the value, record a one-line "decision not to
do this" in the plan bookkeeping with an explicit reason.

**Definition of done:** one predicate answers the question; or the decision not
to do it is recorded with a load-bearing reason; the kids sweep stays green.

---

## Phase 11 — close-out

11.1 Docs: `specs/42` closes with `Status: done`; `roadmap.md` gets an item 42
     entry linking this file; `LIMITATIONS.md` gains any constraint discovered
     (e.g., the privacy-notice-offline-state honesty note, and whether the
     client-side notice duplicates the server copy).
11.2 Final verification, in order: `make test`, both typechecks,
     `npm --prefix client run build` + bundle budget, `npm audit
     --audit-level=high` both tiers. Record results here.
11.3 The re-audit HTML remains in %TEMP% as a working artefact; if the file is
     to be kept in the repo, its path is listed here and committed.

## Effort shape (rough)

| Phase | Size | Risk |
|---|---|---|
| 0 | S | none (read-only) |
| 1 | M | WakeBudget extraction has broad reach; covered by new tests |
| 2 | M | Non-trivial — controllerchange timing interacts with `<audio>`; test carefully |
| 3 | M | Deleting bypass sites may uncover a call that *actually* needed boundedFetch (e.g., a polling heartbeat with no session yet) |
| 4 | M | Client-side notice or precached-shell path adds bytes to the budget |
| 5 | S | Pure docs; nothing to break |
| 6 | S | Smaller than it looks; the stale closures are always observable when reproduced |
| 7 | S–M | Touches the composite-key sites — the key is pinned by test; low risk |
| 8 | M | Largely mechanical after the first naming decision |
| 9 | S | The admin status field is display-only; the family default is guarded by the 404 test |
| 10 | S | A rename or a documented decision; one or the other |
| 11 | S | Bookkeeping |

## Close-out (2026-11-16)

All phases landed on master. Verification record, in the order this plan
required:

- Server suite: 828 passed, 4 skipped (832). One full run showed the known
  load flake (`scanner.integration.test.ts`, ~10 s timeout); it passes alone
  and on re-run. Documented in LIMITATIONS §5.
- Client suite: 989/989 across 94 files (~66–85 s). Two files failed once
  under full-suite load (`Settings.test.tsx`, `PasskeySettings.test.tsx`) —
  both pass in isolation and on re-run; LIMITATIONS §5.
- Both typechecks green. Client build ~15–20 s.
- Bundle: app chunk 289.68 kB (gzip 87.34) against the 2026-11-16 Phase-0
  baseline of 289.70 kB — the phases added no net weight to the hot chunk;
  CSS 70.46 kB. The `/privacy` notice ships as its own precached lazy chunk
  (9.93 kB, 3.21 gzip), so shell-fallback navigations render it offline.
- `npm audit --audit-level=high`: server clean; client 4 low-severity, all
  inside the build toolchain (deepmerge in `@rollup/plugin-node-resolve`
  via workbox-build/vite-plugin-pwa — fix requires a breaking downgrade;
  not taken).
- GDPR: household `/api/me/export`, self-erasure and the Art. 16 PATCH now
  carry `x-profile-id` via the request interface; the bypass class is closed
  by the `noBypassFetch` sweep; the privacy notice is reachable with the
  server hot, waking and cold; specs 29/30 and ADR 020 document the
  `books/srv-<hash>/` file layer.
- Re-audit report: `architecture-review-2026-11-16-1147.html`, kept in %TEMP%
  as a working artefact; not committed. Phase 4's live verification of the
  in-app `/privacy` route was exercised against the dev stack (a browser
  renders the notice); a production check — navigate to `/privacy` with the
  server cold or waking — is the deployer's final smoke test.
- One process note: commit 8ebf932 pushed red (`tsc -b` error in
  `experience.test.ts`; vitest does not typecheck). Fixed in 3126529 and
  pushed immediately; HEAD verified green end to end (build, both suites).
