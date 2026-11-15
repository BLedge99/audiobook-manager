# Spec 41 — Audit remediation: the 2026-11-15 review, phase by phase

> **Status: planned.** Written from the 2026-11-15 architecture audit
> (`architecture-review-2026-11-15-1154.html`, explore-verified). Every phase is
> self-contained and independently mergeable. Read "How to work this plan"
> before starting anything.

## Purpose

The 2026-11-15 audit found nine candidates. Four are the spec-37 failure shape
recurred in the newest code — a tested pure module whose callers kept their own
copy (buy links vs the store registry; the age ladder; the kids buy surfaces;
the refresh coalescer). One is a live data bug: the offline library keys its
database rows per server but its audio files by bare book id. The rest are
shallow or unenforced seams found along the same seams.

Nothing here reopens a decision recorded in `decisions/`. Card 1 *completes*
ADR 020 / spec 30 rather than reopening it; cards 5 and the GDPR wording step
discharge the obligation spec 37 step 6.1 left implicit; no ADR is contradicted.

## Scope

Nine audit candidates, mapped to phases. Ordering is by dependency and blast
radius, not severity — except that Phase 1 (the data bug) goes first.

| Phase | Audit card | Outcome |
|---|---|---|
| 0 | — | Baseline measured, tree green, audit report filed |
| 1 | 1 | Offline audio lives under a per-server directory; shelves can never clobber each other's files |
| 2 | 2 | `buildBuyLinks` composes the store registry; no URL is written twice |
| 3 | 3 | The age ladder is one fixture both test suites read; fail-closed is contractual, not copied |
| 4 | 4 | One client module owns “may this session see buy surfaces?”; a render sweep proves it |
| 5 | 5 | Erasure, export and the schema guard are all generated from one declarative table |
| 6 | 6 | One refresh-coalescing helper for `useBrowse` and `useLibrary` |
| 7 | 7 | The shelf refresh does one bulk read + bounded-parallel decrypts |
| 8 | 8 | `AccountGate` is a mode-transition controller over three surfaces |
| 9 | 9 | The small-seams sweep: rate limiter, key spellings, tripled line, listener wiring |
| 10 | — | Docs, GDPR wording, roadmap/spec bookkeeping, final verification |

Out of scope:

- **No HTTP response shape changes.** The phone may be a version behind.
- **No rewrites.** Phase 8 splits `AccountGate`; it does not redesign it.
- **No new framework, state library or test runner.**
- **No new dependency.** The per-server directory hash uses `@noble/hashes`,
  already a client dependency.
- **No E2E requirement** except where a phase says so. Unit + integration
  suites are the gate; `make test-e2e` stays where it is.

## How to work this plan

1. **Test first, observed failing, then the implementation.** If you cannot
   make the test fail for the right reason, the test is wrong — fix the test.
2. **One step per commit.** The commit message names the step:
   `fix(client): per-server audio directories (spec 41 step 1.3)`.
3. **The tree is green at the end of every step.** `make test`, both
   typechecks, and the bundle budget must pass.
4. **Do not start a phase whose predecessor is not merged** — except 2–4,
   which are independent of each other (but not of Phase 0).
5. **Phases 1, 5 and 10 involve GDPR-adjacent surfaces.** If a step turns
   out to touch personal data beyond what is written here, stop and say so.
6. If a premise in this plan turns out to be wrong, **stop and write it down**
   rather than improvising. A finding that invalidates a phase is worth more
   than the phase.

---

## Phase 0 — Baseline

**State on entry:** master at the audit commit. **Files:** none (read-only).

0.1 Run `make test` and both typechecks; record suite counts and duration.
0.2 Run `npm --prefix client run build` and `node scripts/check-bundle-size.mjs`;
    record the numbers in this file's status block when the plan closes.
0.3 File the audit report itself: copy `architecture-review-2026-11-15-1154.html`
    reference into the phase 10 bookkeeping step (the report lives in %TEMP%;
    the *findings* live here).

**Definition of done:** green tree, numbers recorded, no code changes.

---

## Phase 1 — Per-server audio directories (audit card 1)

> The bug: `replica.ts` keys DB rows `<serverId>#<bookId>` but `trackPath`
> writes `books/<bookId>/<trackId>.<ext>` — a bare book id. Two servers both
> numbering books from 1 write the same folder. Server B's download of book 7
> clobbers server A's; `removeDownloadedBook(A#7)` deletes B's audio;
> `recoverBooks` adopts orphans by bare numeric id with no shelf discrimination.
> ADR 020 and spec 30 decided the composite key; the file layer never got it.

**Files** (client only): `client/src/local/replica.ts`, `local/recover.ts`,
`local/download.ts`, `local/useDeviceLibrary.ts`, `local/db.ts` (if a constant
is needed), plus colocated tests (`replica.test.ts`, `recover.test.ts`,
`download.test.ts`, `useDeviceLibrary.test.ts`).

### Step 1.1 — one hash module decision, one dir key

**Test first** (`replica.test.ts`): `bookDir(serverId)` returns a stable,
filesystem-safe, ≤ 32-char segment; distinct for distinct serverIds;
`bookDir("")` returns `"local"`; and `bookDir` never contains `/`, `\`, `:`,
or whitespace.

**Then:** `bookDir(serverId)` in `replica.ts`: SHA-256 (first 16 hex chars, via
`@noble/hashes/sha256`) of the serverId — a URL must not appear on disk (it may
carry a LAN hostname, and cloud-synced backups must not learn it). Empty
serverId maps to `local`. Export `BOOK_DIR = "books"` unchanged.

### Step 1.2 — `trackPath` takes the server

**Test first:** `trackPath(serverId, bookId, trackId, extension?)` →
`books/srv-<hash>/<bookId>/<trackId>.<ext>`; legacy signature is gone; every
caller updated by this commit.

**Then:** change the signature; update `download.ts:146`, `recover.ts:179`,
and all tests. `useDeviceLibrary.localUrlForTrack` reads the **stored** path —
untouched. Stored paths in existing rows are never rewritten (step 1.6).

### Step 1.3 — downloads write per-server dirs

**Test first** (`download.test.ts`): a download requested against server A and
the same book/track against server B lands in two distinct directories;
headers/progress wiring unchanged.

**Then:** `download.ts` passes `book.serverId ?? getServerUrl()` into
`trackPath` (one call site).

### Step 1.4 — recovery scans both layouts, discriminates shelves

**Test first** (`recover.test.ts`):
- given per-server dirs `books/srv-a…/7/…` and `books/srv-b…/7/…` for the two
  configured servers, recovery against server A adopts only `srv-a…/7` files;
- given a legacy `books/7/…` folder and no per-server rows anywhere, recovery
  against server A adopts it into A's shelf (the documented legacy heuristic —
  same behaviour as before this plan, now explicit);
- `findUnclaimedBookIds` is never offered another server's per-server dir.

**Then:** `recover.ts`: `listUnclaimedOnDevice` and `recoverBooks` compute
`bookDir(sourceServer)`; listing covers (a) the active server's per-server
dir and (b) the legacy root, filtering legacy entries to those not claimed by
any row for *any* shelf (a bare `7/` might belong to a departed shelf).
Recovery result gains no new fields; logs note which layout an adoption used.

### Step 1.5 — adoption targets the listing shelf

**Test first:** recovering `srv-a/7` against server A writes rows keyed
`A#7` and paths under `srv-a…/7/`; the same bytes are never double-adopted
for B.

**Then:** in `recoverBooks`, per-server matches reuse `trackPath(sourceServer,
…)`; legacy matches reuse the legacy path layout but still adopt into the
`sourceServer` shelf (stored path stays legacy — that is correct, the files
really live there).

### Step 1.6 — existing rows are never rewritten

**Test first:** a replica row whose stored path is the legacy layout still
reports fully-downloaded, still plays, and `removeDownloadedBook` deletes the
legacy path exactly once.

**Then:** no code — this step exists to pin the no-migration guarantee with
tests before anything else lands.

### Step 1.7 — documentation

`specs/29` / `specs/30` gain a "file layer" note (one paragraph each, or a
cross-reference here). LIMITATIONS: if it documents the legacy recovery
heuristic, update the wording to name both layouts.

**Verify, in order:** targeted suites → `make test` → client typecheck →
bundle budget → (manual smoke, optional) download same id from two servers.

**Definition of done:** two servers, same numeric book ids, zero shared
directories; recovery on each server touches only that server's audio;
legacy audio survives untouched.

---

## Phase 2 — Buy links compose the registry (audit card 2)

**Files:** `client/src/lib/externalStores.ts`, `lib/buyLinks.ts`,
`lib/buyLinks.test.ts`, `lib/externalStores.test.ts`.

### Step 2.1 — the registry grows the two search-only vendors

**Test first:** `EXTRA_VENDORS` (exported, frozen) exposes exactly `bookshop`
and `bn`, each with `label`, `searchUrl(query)`, and the affiliate vendor id
matching `AffiliableVendor` in `affiliateConfig.ts`. Kobo's registry URL stays
region-pinned `us/en` (documented in-registry; do not add a region setting).

**Then:** implement in `externalStores.ts` (the one module that owns "what
hosts a store URL"). No parsing is added for these two — that is deliberate
(spec 39 / ADR 034: we never parse what we cannot canonicalise safely).

### Step 2.2 — `buildBuyLinks` delegates

**Test first:** for isbn-present and title/author inputs, every emitted store
URL equals `EXTERNAL_STORES[x].searchUrl(query)` (the four registry stores) or
`EXTRA_VENDORS[x].searchUrl(query)` (bookshop, bn), plus `withTag` when
configured. Audible and playbooks rows carry no tag and `commission: false`,
always. LibriVox row first, untagged, only when `librivoxUrl` is set — pin
existing behaviour.

**Then:** rewrite the row builders to compose; delete every literal store host
in `buyLinks.ts` (exactly four sites: librofm, kobo, audible, playbooks —
bookshop and bn are already literals there and move to `EXTRA_VENDORS`).
`query` passed to `searchUrl` is the **raw** query (registry encodes);
ISBN-13 path unchanged.

### Step 2.3 — the cross-check test

**Test first:** a test that fails if a registry search URL and the emitted buy
row disagree — assert emitted href (minus tag) `===` registry `searchUrl`
output for all six vendors; assert B&N keeps `?ean=` when an ISBN-13 is
supplied (its one deliberate divergence, encoded in `EXTRA_VENDORS.bn.searchUrl`).

**Verify:** `make test-client` → `make test`.

**Definition of done:** no store host appears in `buyLinks.ts`; changing a
registry URL changes the sheet; the suite proves it.

---

## Phase 3 — One age-ladder contract (audit card 3)

**Files:** `test-fixtures/age-ladder.json`, `server/src/age/bands.test.ts`
(new contract describe block), `client/src/local/ageFilter.test.ts`.

### Step 3.1 — the fixture

`test-fixtures/age-ladder.json` (committed; the root `test/` dir is gitignored —
it holds large sample media):

```json
{
  "bands": ["under-6", "6-9", "10-13", "14-17"],
  "maxAgeByBand": { "under-6": 5, "6-9": 9, "10-13": 13, "14-17": 17 },
  "strictestMaxAge": 5
}
```

### Step 3.2 — server asserts against it

**Test first:** `MAX_AGE_BY_BAND` deep-equals `maxAgeByBand`; `AGE_BANDS`
equals `bands`; `maxAgeForBand("bogus") === strictestMaxAge`;
`maxAgeForBand(undefined) === strictestMaxAge`. Read the fixture with `node:fs`
(server tests already do this pattern — see `personal-data.test.ts`).

### Step 3.3 — client asserts against it

**Test first:** `AGE_BAND_MAX` deep-equals `maxAgeByBand`;
`offlineMaxAge("bogus") === STRICTEST_MAX_AGE`; the client band list (add
`AGE_BANDS` export, mirroring the server) equals `bands`. Same fixture, same
assertions, two suites — that is the contract.

**Then:** export `AGE_BANDS` from `ageFilter.ts` if the client suite needs it;
no runtime change otherwise.

**Note:** this does **not** try to share code across the tier seam — it pins
the two existing implementations to one recorded fact. If they ever diverge, CI
goes red on both sides.

**Verify:** `make test`. **Definition of done:** both suites read one fixture;
a re-band on either side fails CI.

---

## Phase 4 — One client kids-account policy module (audit card 4)

> The server grew `age/` — a deep module. The client got a band filter and
> seven hand-rolled `role !== "child"` sites: App (×3: the external-books
> button ~960, the ExternalBooks block ~1029, the Discover `canBuy` prop
> ~1092), `Discover` (prop, threaded twice), `ExternalBooks` (×2),
> `GetThisBookSheet` (`isChild`), `AccountMenu` (role check).

**Files:** `client/src/local/kids.ts` (new), `App.tsx`, `Discover.tsx`,
`ExternalBooks.tsx`, `GetThisBookSheet.tsx`, `AccountMenu.tsx`,
`kidsSurface.test.tsx` (new).

### Step 4.1 — the module

**Test first** (`kids.test.ts`): `canSeeBuySurfaces("admin"|"member"|undefined) === true`;
`canSeeBuySurfaces("child") === false`; `isKidsAccount` inverse. Fail-closed on
unknown roles? **No** — unknown roles are not children (the server defaults
handle visibility; this predicate answers only "is this the child role").
Document that in the module header.

**Then:** `local/kids.ts` with the two predicates. No React, no copy.

### Step 4.2 — call sites compose it

**Test first:** none new at this step; existing suites are the tripwire.

**Then:** replace all seven sites with `canSeeBuySurfaces(session?.role)`.
Props stay where they are (`canBuy`, `isChild`, `role`) — leaf components keep
their narrow interfaces; **derivation** happens once per surface, in the
parent or inline, via the predicate. Do not prop-thread a session object.

### Step 4.3 — the render sweep

**Test first** (`kidsSurface.test.tsx`): render (a) the shelf area with the
Add-external-books affordance, (b) `ExternalBooks`, (c) `GetThisBookSheet`,
(d) `Discover` sections carrying buy rows, under a child session and an adult
session; assert the child render contains zero buy affordances (by
`copy.external` strings / testids already present) and the adult render does.

**Then:** implement until green. If a surface resists rendering in jsdom,
sweep the *predicate* call sites statically (a source-grep assertion test)
instead — document which you did.

### Step 4.4 — docs

One line in `specs/38` pointing at `local/kids.ts` as the client-side
counterpart of `age/`; no spec change beyond that.

**Verify:** `make test-client` → `make test`. **Definition of done:** one
predicate; zero inline `role !== "child"` / `role === "child"` outside the
module and its tests.

---

## Phase 5 — GDPR: one table drives validate, export, erase (audit card 5)

> `PROFILE_PERSONAL_DATA_MODELS` is schema-guarded and complete — but
> `eraseProfilePersonalData` and `exportProfilePersonalData` are hand-written
> against it. Add a 12th model to the constant and the suite stays green while
> the table is never erased: the module's own promise (“they cannot drift
> apart”) is enforced for the list only.

**Files:** `server/src/gdpr/personal-data.ts`, `personal-data.test.ts`.

### Step 5.1 — the declarative table

**Test first:** the existing list-equality test is kept (renamed if needed);
new: every row's delegate name appears in `PROFILE_PERSONAL_DATA_MODELS`, and
the model list is derived, not duplicated: `PROFILE_PERSONAL_DATA_MODELS ===
PERSONAL_DATA_ROWS.map(r => r.model)`.

**Then:** replace the constant with `PERSONAL_DATA_ROWS: ReadonlyArray<{
model, delegate, export: { select, orderBy? }, erase: "deleteMany" | "delete",
}>` in deletion order (children before `profile`). Keep
`PROFILE_PERSONAL_DATA_MODELS` as a derived export for compatibility (tests
and possibly callers). Selects move into the rows verbatim — **no field may
be dropped or added in this refactor**; the export payload must be
byte-identical. Write a before/after payload comparison against a fixture (or
snapshot the current `exportProfilePersonalData` output shape in the test).

### Step 5.2 — executors generated from the table

**Test first:** the export keys equal the row list order; erasure deletes
exactly the row set in row order inside one `$transaction`; `profile` uses
`delete`, all others `deleteMany`.

**Then:** build export and erasure from `PERSONAL_DATA_ROWS`. Types: the
selects are heterogeneous; type rows loosely (`select: Record<string, true>`,
delegate via a helper) rather than fighting Prisma's generics — runtime
correctness is what the tests guard. Order of `Promise.all` vs transaction
unchanged.

### Step 5.3 — the schema guard covers the executors

**Test first:** extend the `prismaModelsWithProfileId` guard: every
profile-id-bearing Prisma model must appear as a row **and** each row must
declare an erase strategy; a row naming a delegate absent from the client
fails.

**Then:** implement the guard additions.

### Step 5.4 — GDPR records

Update `docs/roa.md`, `docs/retention.md` and `docs/GDPR-REMEDIATION-PLAN.md`
to state that erasure/export/validation are generated from one declarative
table (not merely "all read the same list"). If the remediation plan lists a
"follow-up: enforce the list" item, tick it with a pointer to this spec.

**Verify:** server suite → `make test`. **Definition of done:** adding a
profile-id-bearing model without a row fails CI; with a row but no erase
strategy fails CI; the export payload is unchanged.

---

## Phase 6 — One refresh coalescer (audit card 6)

**Files:** `client/src/lib/coalesceRefresh.ts` (new), `lib/coalesceRefresh.test.ts`,
`useBrowse.ts`, `useLibrary.ts`.

### Step 6.1 — the helper

> **Premise corrected during implementation (2026-11-15).** An earlier draft of
> this step had the helper queue at most one trailing run. That broke the
> pinned `useLibrary` contract — five triggers overlap constantly and the
> suite pins one request per endpoint per burst — and would have re-stacked
> requests on the hottest path in the app. The trailing run was removed from
> `useBrowse` too (its refreshes are snapshot-friendly; mid-run callers now
> ride the shared batch, and a caller that needs freshness after the run must
> call `refresh()` again, like `refreshForProfile` does). `useBrowse.test.tsx`
> now pins one shared batch (5 calls, not 10).

**Test first:** concurrent calls share one invocation; a call made after the
run finishes starts a fresh run; a rejected run does not poison the next;
callers never receive `undefined`.

**Then:** `coalesceRefresh(fn: () => Promise<void>): () => Promise<void>` —
share `inFlightRef` semantics (the `useLibrary` behaviour) exactly, with no
trailing run. One test file pins the contract.

### Step 6.2 — `useLibrary` adopts it

ETag logic stays inside the wrapped function; the three `while
(inFlightRef.current)` loops in `refreshForProfile` /
`refreshAfterMembershipChange` become `await coalesced()` (they need
“after any in-flight run finishes, I run” — the helper's trailing semantics
give exactly that; otherwise keep the loop against the shared promise).

### Step 6.3 — `useBrowse` adopts it

Replace `inFlight`/`queued` refs; delete the `undefined`-returning path;
behaviour change is invisible to callers (they `void refresh()` or ignore the
result). The trailing-run `while (true)` loop moves inside the wrapped fn.

**Verify:** client suite → App-level shelf tests → `make test`.
**Definition of done:** no `inFlight`/`queued` refs outside the helper; one
test file pins the contract.

---

## Phase 7 — Batch the shelf refresh decrypts (audit card 7)

**Files:** `client/src/local/privateCache.ts`, `local/privateCache.test.ts`,
`local/useDeviceLibrary.ts`, `local/useDeviceLibrary.test.ts`.

### Step 7.1 — one bulk reader

**Test first:** `getPrivateValues("progress", keys)` issues one `bulkGet`
(assert via an instrumented fake db — the suite already fakes IndexedDB) and
decrypts in parallel; misses fall back per-key to the legacy bare-id rows in
the same batched pass; rows for absent keys are absent from the result map.

**Then:** factor the row→plaintext decrypt out of `getPrivateValue`;
implement `getPrivateValues` over `db.privateRows.bulkGet`; keep
`getPrivateValue` as a thin wrapper.

### Step 7.2 — the refresh path uses it

**Test first:** `useDeviceLibrary.refresh` with N rows performs O(1) db gets
for the envelope + O(1) bulkGet for progress rows (instrument the fake db and
count); progress values still appear on the rows; a locked profile still
renders books without resume points.

**Then:** replace the per-row `await readProgress(...)` loop with one
`getPrivateValues` call keyed by `replicaBookKey(serverId, id)`; merge.

**Verify:** client suite → `make test`. **Definition of done:** no per-row
await of crypto in the refresh path; correctness unchanged.

---

## Phase 8 — AccountGate: a controller over three surfaces (audit card 8)

> 959 lines, six modes (`list | password | setup | household | register |
> email`), every auth spec landing there. The tests are good; the interface is
> the problem. This phase moves code; it changes no behaviour and no markup —
> `AccountGate.test.tsx`, `.biometric.test.tsx`, `.oauthNative.test.tsx` must
> pass unmodified throughout.

**Files:** `components/AccountGate.tsx` → split into
`components/accountGate/AccountGate.tsx` (controller),
`…/GateList.tsx`, `…/AccountGateForm.tsx` (the per-account flows),
`…/shared.ts` (types + mode union). `ui/primitives` untouched.

### Step 8.1 — baseline pin

Run the three suites; record counts. Any existing flakes get noted here, not
fixed silently.

### Step 8.2 — carve the seams (no moves yet)

Define the props interfaces for the three surfaces from the controller's
current render blocks; pure type extraction plus one commit.

### Step 8.3 — extract `GateList`

The account/profile picker surface (the `list` mode render block and its
handlers) moves verbatim; the controller passes props. Tests stay green.

### Step 8.4 — extract `AccountGateForm`

The `password | setup | household | register | email` flows move as one
sibling (they share the submission plumbing and OAuth/passkey delegation —
do **not** split them further in this phase). The controller keeps the mode
union, transitions, and cross-surface effects (`lockOfflineCache`, OAuth
result pickup).

### Step 8.5 — the demo surface check

The demo account picker rides `list` today; if it is cleanly separable it
becomes a third sibling (`DemoSurface`) inside this phase; otherwise it stays
inside `GateList` and this plan says so in one line. Do not force it.

### Step 8.6 — close

Controller ≤ ~300 lines; each surface ≤ ~350; no export changes for
`App.tsx:743–768`.

**Verify:** the three suites after every step; `make test-client`; visual
smoke optional (E2E account flows exist — `make test-e2e` with stack up,
recommended once at phase end).

**Definition of done:** behaviour identical; the mode union is the
controller's interface; each surface readable in one screenful.

---

## Phase 9 — The small-seams sweep (audit card 9)

Each step is its own commit and stands alone. 9.1 is server; 9.2–9.3 client;
9.4 server; 9.5 is stretch.

### Step 9.1 — buy-context uses the shared limiter

**Test first:** existing `routes/buy-context.test.ts` keeps passing unmodified
(429 after 30/min per profile); add: expired windows reset; the limiter map
never grows past `maxEntries` (spray 2,000 distinct profile ids, assert
`size <= maxEntries`).

**Then:** `new RateLimiter(60_000, …)` with allow/record, same shape as
`auth/service.ts`; delete the bespoke `counters` map and
`clearBuyContextRateCounters`'s internals (keep the exported test seam,
reimplemented as `limiter.clear(String(profileId))` or a fresh instance).

### Step 9.2 — one spelling of the composite key

**Test first:** `replicaBookKey` is imported by `AudiobookGrid` (×2 keys),
`AudiobookDetail`, `Shelves`; a key snapshot test pins `${serverId ?? ""}#${id}`
output; `bookCoverKey(7, "https://x") === "book:" + replicaBookKey("https://x", 7)`.

**Then:** export `replicaBookKey` from `local/replica.ts` (it is the DB key —
already exported; just import it at call sites); rewrite `bookCoverKey` to
compose it; codemod the three JSX files; leave `urlCoverKey` alone.

### Step 9.3 — one demo-branch line in `useSession`

**Test first:** three identical statements replaced by one
`resolveSessionProfileId()`; `useSession.test.ts` stays green.

**Then:** add the local helper; call at :83, :113, :119.

### Step 9.4 — shared listener wiring lifted

**Test first:** a test for `registerClientDist(app, dir, { onAssetMiss })`
covering: hashed `/assets` immutable; shell `must-revalidate`; `/api` 404s as
JSON; asset miss → 404 never index.html (both listeners) — port of the
spec-38 lesson test in `static-assets.test.ts` to a shared module's own tests.

**Then:** new `server/src/shared/listener.ts` (create the `shared/` dir):
`collectApiDocs(app)` (the `apiDocs` + `onRoute` pair),
`registerClientDist(app, { distDir })` (existsSync → static → notFound
handler, including the `CLIENT_DIST`/`ADMIN_CLIENT_DIST` env split via an
option), `sharedCorsOrigins()` (the allow-list both construct).
`app.ts` and `admin/app.ts` consume all three. **Admin gets the same
CORS list it has today** — verify by diffing the emitted headers before/after
in the admin static test.

### Step 9.5 — (stretch) `api.ts` thins out; server root groups

Two independent, optional moves. (a) `lib/api.ts` → `lib/serverUrl.ts`
(resolution/normalising) + `lib/sessionToken.ts` (in-memory token + legacy
`SESSION_TOKEN_KEY` removal, moved out of import time into `main.tsx`
bootstrap), `api.ts` re-exports for one release. (b) server's ~40 loose root
files → `platform/` (`http-errors`, `conditional`, `bigint`, `request-context`,
`safePath`, `static-assets`, `rate-limit`) and `shared/` (from 9.4). Pure
moves; every import updated; no behaviour change. **Only if 9.1–9.4 land
clean and nothing else is pending** — this is wayfinding, not leverage.

**Verify (each):** targeted suite → `make test`. **Definition of done
(mandatory steps):** no bespoke limiter; no hand-written composite key in
JSX; no duplicated listener wiring.

---

## Phase 10 — Close-out

10.1 GDPR paperwork: verify Phase 5 wording landed in `docs/roa.md`,
     `docs/retention.md`, `docs/GDPR-REMEDIATION-PLAN.md`; note in
     `LIMITATIONS.md` if any behaviour changed that it documents (Phase 1
     recovery semantics).
10.2 `specs/41` status → done, with a reconciliation note (what landed, what
     was descoped, any premise that failed), same style as spec 37's.
10.3 `roadmap.md` item 41 already exists; add a closing note.
10.4 Final verification, in order: `npm --prefix client run build` +
     `node scripts/check-bundle-size.mjs`; both typechecks; `make test`;
     `npm audit --audit-level=high` both tiers (CI parity). Record results in
     this file.
10.5 The audit report HTML is %TEMP% by design; if the team wants it
     preserved, attach it to the PR or paste findings into this file's
     appendix — do not commit the %TEMP% path.

## Effort shape (rough)

| Phase | Size | Risk |
|---|---|---|
| 1 | M | data migration adjacency — every step is pinned by tests first |
| 2 | S | low |
| 3 | S | low (pure contract tests) |
| 4 | S–M | jsdom render sweep may need a source-grep fallback |
| 5 | M | Prisma generic typing — keep rows loosely typed |
| 6 | S | behavioural unification, invisible to callers |
| 7 | S | low |
| 8 | L | mechanical but large; tests are the safety net |
| 9 | M | 9.1 and 9.4 carry the only server-side risk |
| 10 | S | bookkeeping |

## What this plan refuses to do

- Rethread `x-profile-id`, sessions, or auth — nothing here touches sign-in.
- Change any API response shape.
- Add a migration. Phase 1 deliberately keys new files per server and leaves
  existing rows alone.
- Parse bookshop.org or Barnes & Noble product URLs.
- Unify the client and server into one age-ladder module — the seam is real;
  the contract is what we share.
