# Spec 37 — Architecture deepening: nine deepening opportunities

> **Status:** planned. Every step below is self-contained and independently
> mergeable. See "How to work this plan" below before starting anything.

## Purpose

An architecture review on 2026-11-11 found nine places where this codebase has
**shallow modules** — modules whose interface is nearly as complex as their
implementation — and where knowledge **leaks across seams**. This spec turns
those findings into a sequence of test-first steps.

The findings are not nine unrelated bugs. They are one recurring shape: a
**rule was extracted into a pure function and tested, but the code that calls
it kept its own copy of the rule.** The consequences are consistent:

- the tested module is not the one that runs (`metadata/precedence.ts`),
- a rule is re-derived at each call site (`writable(field)` in three places),
- two paths exist for one concept (online shelf vs offline shelf),
- and the places with the most bugs are the places with the least test
  coverage (`App.tsx` has no test file at all).

The plan is therefore ordered **by dependency**, not by severity. Each step
leaves the tree green.

## Scope

Nine candidates, from the review's report. The ordering below is this plan's
own; the review's "top recommendation" (candidate 02) is **Step 2.1**, because
it fixes a live bug and it is the step that unlocks the client work.

The **server** phases run in a different order from the review's numbering, and
deliberately so: the two rule extractions (phases 5 and 6) land **before** the
route split (phase 7). Both extract a rule out of `server/src/app.ts`, and
phase 7 moves `app.ts` apart. Consolidating first means the split moves
already-consolidated code instead of scattering a rule that is still in three
places.

| Plan step | Candidate | Outcome |
|---|---|---|
| 0.x | — | Foundations: typecheck script, test helpers |
| 1.x | — | Client: one request interface (candidate 01) |
| 2.x | — | Client: one offline key format (candidate 02, part 1) |
| 3.x | — | Client: the library source seam (candidate 02, part 2) |
| 4.x | — | Client: the orchestration layer gets a home (candidate 03) |
| 5.x | — | Server: one module owns field precedence (candidate 05) |
| 6.x | — | Server: one list of personal-data tables (candidate 06) |
| 7.x | — | Server: split the route table (candidate 04) |
| 8.x | — | Client: keep copy out of logic modules (candidate 07) |
| 9.x | — | Server: the AI feature gets a real seam (candidate 08) |
| 10.x | — | Server: one home for the provider clients (candidate 09) |

### Out of scope

- **Do not rewrite `App.tsx` or `app.ts` wholesale.** Every step here is a
  move or a rule extraction, never a rewrite. A rewrite of 2,000 lines cannot
  be reviewed and is exactly how the current entanglement happened.
- **Do not change any HTTP response shape** unless a step says so explicitly.
  The client and the server ship together but the phone may be a version
  behind.
- **Do not add a framework, a state library, or a test runner.** Vitest,
  Testing Library and `inject` are what the repo already uses.
- **The `derived` layer of the precedence chain** (ADR 009) is not implemented
  in this plan. Step 5.1 records the decision instead; see "Decisions this
  plan needs".

---

## How to work this plan

### The rules

1. **A test is written and observed failing before the implementation that
   satisfies it is written.** If you cannot make the test fail for the right
   reason, the test is wrong — fix the test, not the implementation.
2. **One step per commit.** A commit implements one step and nothing else.
   The commit message names the step: `refactor(client): one request interface (spec 37 step 1.2)`.
3. **The tree is green at the end of every step.** `make test` must pass.
   If a step cannot be merged without breaking another step, the steps are
   wrong — split the step.
4. **Do not start a step whose predecessor is not merged.** The steps are
   ordered; each one assumes the previous one's shape.
5. **If a step's premise turns out to be wrong**, stop and write it down. A
   finding that invalidates the plan is worth more than the step.

### Picking up the plan mid-way

The plan is designed so a new agent can start at any step boundary. Each step
below states:

- **State on entry** — what the tree looks like when you arrive.
- **Files** — exactly what you may touch. Nothing else.
- **Test first** — the test to write, and what it should assert.
- **Then** — the implementation.
- **Verify** — the commands to run, in order.
- **Definition of done** — the checkboxes that mean it is finished.

If a step is interrupted half-way, the tree may be red. That is expected and
recoverable: `git status` shows the half-finished work, and the step's
"Test first" section tells you what was being built. Revert with
`git checkout -- <paths>` if the half-finished state is not worth keeping.

### Claiming a step

Several people may work this plan at once. The steps are ordered, so **two
people must not be inside the same step** — but they may be inside different
steps of the same phase only if those steps touch different files. Steps that
touch the same file are sequential, and the plan says so where it matters
(the client phases all touch `App.tsx` or `api.ts`; the server phases all
touch `app.ts`).

Claim a step by taking it in this order:

1. **Check the tracker** below. If the step is marked `in progress` with a
   name and a date, someone has it — pick another step.
2. **Claim it in the tracker** before you write any code: set the status to
   `in progress` and put your name and the date in the row. A one-line commit
   on this file is enough; it is the claim.
3. **Do the work.** One step, one commit, as above.
4. **Release the step** by setting the status to `done` and appending the
   commit hash.

If you abandon a claimed step, set the status back to `not started` and note
why in the row. A step left `in progress` with no activity for a week is
stuck; say so rather than leaving it ambiguous.

### Progress tracker

| Step | Status | Claimed by | Commit |
|---|---|---|---|
| 0.1 typecheck into `make test` | done | opencode | (this commit) |
| 0.2 client request test helper | done | opencode | fe5b2ad |
| 1.1 name the request guarantees | done | opencode | d1521bb |
| 1.2 `useLibrary` + `useBrowse` | done | opencode | 331f336 |
| 1.3 the components | done | opencode | 79473e6 |
| 1.4 the admin client | done | opencode | 287e256 |
| 1.5 retire the fetch shim's leftovers | done | opencode | (next commit) |
| 1.6 delete the fetch shim | not started | | |
| 2.1 prove the key collision | not started | | |
| 2.2 server-scoped private keys | not started | | |
| 3.1 the library source interface | not started | | |
| 3.2 both hooks satisfy it | not started | | |
| 3.3 collapse the merge | not started | | |
| 4.1 profile-resolution rules | not started | | |
| 4.2 refresh-trigger rules | not started | | |
| 4.3 the background lock | not started | | |
| 4.4 the offline gate | not started | | |
| 4.5 the session probe | not started | | |
| 4.6 the offline-mode flag | not started | | |
| 5.1 decide the precedence chain | not started | | |
| 5.2 the rule in one module | not started | | |
| 6.1 the personal-data list | not started | | |
| 6.2 the schema guard | not started | | |
| 7.1 the route table as a test + schemas | not started | | |
| 7.2 taxonomy routes | not started | | |
| 7.3 discover and wishlist routes | not started | | |
| 7.4 library and membership routes | not started | | |
| 7.5 enrichment routes | not started | | |
| 7.6 the demo-mode policy | not started | | |
| 7.7 the remaining routes | not started | | |
| 7.8 share the listener logic | not started | | |
| 7.9 the admin proxy's scope | not started | | |
| 8.1 copy out of `position.ts` | not started | | |
| 8.2 copy out of `browse.ts` | not started | | |
| 8.3 copy out of the local modules | not started | | |
| 9.1 inject the AI adapter | not started | | |
| 9.2 stop sending the server path | not started | | |
| 10.1 move the provider clients | not started | | |
| 10.2 one similarity function | not started | | |
| 10.3 clean the ADR 008 artefact | not started | | |

The `X` items in "Cross-cutting work" are tracked the same way; add a row
when you claim one.

### Where two people can work at once

The phases are **not** parallelisable end to end — the client phases share
`App.tsx` and `api.ts`, and the server phases share `app.ts`. But these pairs
genuinely do not overlap:

- **Any client phase with any server phase.** Different trees, different
  suites, different files. `make test` runs both, so run it before pushing.
- **Phase 0 with any `X` item.** The `X` items are small and independent.
- **Phase 8 with phases 5, 6 and 7.** Phase 8 is the client copy work; the
  server phases never touch `client/src`.

Within the server, phases 5, 6 and 7 are **strictly sequential** — they all
edit `server/src/app.ts`. That is why they are numbered in that order.

If you are two people and want to work in parallel, the cleanest split is
**one person on the client phases, one on the server phases**. The only
cross-phase coupling is step 7.9, which needs a decision, and step 5.1, which
needs a decision.

### Running the suites

```bash
make test          # copy check + server suite + client suite  (~2 min)
make test-server   # server only (Vitest, SQLite per test file)
make test-client   # client only (Vitest + Testing Library, jsdom)
make check-copy    # the interface copy rules (spec 15b feature 7b)
```

Neither suite typechecks. `vitest run` does not run `tsc`, so a test file that
imports a type which does not exist passes the whole suite and fails only
`tsc`. **Run `npx tsc --noEmit` in `server/` and `npx tsc -b` in `client/`
as part of every step.** Step 0.1 wires this into `make test` so it stops
being a step you can forget.

Full stack, when a step needs it:

```bash
make restart       # recreate the containers after server changes
make test-e2e      # Playwright against the running stack
```

E2E needs WSL + Docker. If Docker runs inside WSL, use `scripts/e2e-wsl.sh`,
which provisions a Linux Node and then delegates to `make test-e2e`.

---

## Decisions this plan needs

Three of the nine candidates touch a recorded decision. Under the repository's
source-of-truth order, `decisions/` outranks code, so these are **not**
refactors — they are decisions that happen to need code.

Each step claims the next ADR number in order: 028, 029, 030.

| Step | Conflicts with | What is needed |
|---|---|---|
| 5.1 | ADR 009 (`decisions/009-field-level-metadata-precedence.md`) | A new ADR (028) recording that the precedence chain is *not* enforced as a chain today, and what replaces it |
| 7.9 | ADR 022 / ADR 025 (admin second listener) | Confirm the family listener should proxy `/admin` in **every** deployment, or only the hosted one |
| 10.3 | ADR 008 / ADR 011 (provider chain, Audnexus is ASIN-keyed) | A new ADR (030) recording Audnexus's role in the provider interface, now that the chain never walks it |

Each of these steps says "**Decision needed**" and stops there. Write the ADR
first, then implement against it. Do not implement and then write the ADR to
match what you implemented — that is how ADR 009's drift happened.

---

## Phase 0 — Foundations

Everything after this phase assumes a typecheck gate and a couple of test
helpers exist. Both are small; both are quoted in `LIMITATIONS.md` §6 already.

### Step 0.1 — Wire a typecheck into `make test`

**State on entry:** `master` is clean. `make test` runs the copy check and the
two unit suites but no typecheck.

**Why:** `vitest run` does not typecheck. A test file importing a type that
does not exist passes the whole suite and only fails `tsc`, which is a manual
step and therefore easy to skip. `LIMITATIONS.md` §6 item 17 already queues
this.

**Files:**
- `server/package.json` — add a `typecheck` script
- `client/package.json` — add a `typecheck` script
- `Makefile` — add a `typecheck` target, call it from `test`

**Test first:** none — this step adds no product behaviour. Instead, prove the
gate works:

```bash
# In server/src/scratch-typecheck-probe.ts, add:
export const probe: DoesNotExist = 1;
# Then:
cd server && npx tsc --noEmit   # must FAIL
```

Delete the probe file. A gate that has never been seen to fail is not a gate.

**Then:**

```jsonc
// server/package.json
"typecheck": "tsc --noEmit"
// client/package.json
"typecheck": "tsc -b"
```

```make
typecheck:
	cd server && npm run typecheck
	cd client && npm run typecheck

test: check-copy typecheck test-server test-client
```

**Verify:**
```bash
make typecheck   # passes
make test        # passes, and now includes the typecheck
```

**Definition of done**
- [x] `make typecheck` exists and passes on a clean tree.
- [x] `make test` invokes it.
- [x] The probe file proved the gate fails on a bad type, and was deleted.

**Note (implemented):** `make` is not on the Windows `PATH` in this
environment — it lives in WSL (`/usr/bin/make`), and Git Bash has no `make`
either. The working invocation is:

```
wsl -e bash -lc "cd '/mnt/c/c/Users/benle/Documents/Projects/TechNative/audiobook-manager' && make test"
```

`npm run typecheck` works directly from PowerShell in both packages, which is
the faster inner loop while working on a step.

### Step 0.2 — A client test helper for stubbed requests

**State on entry:** Step 0.1 is merged.

**Why:** Steps 1.x, 2.x, 3.x and 4.x all need to stub `fetch` and assert on
the request. Today every test file writes its own `fakeResponse` — three
copies exist, and they disagree: one knows about ETags, two do not. None of
them records what was actually requested, so a test can answer a request but
never assert on it. A shared helper makes those steps short.

**Files:**
- `client/src/test/requests.ts` — **new**
- `client/src/test/requests.test.ts` — **new** (the helper is itself tested)

**Test first:** write `client/src/test/requests.test.ts` asserting the helper
behaves:

```ts
describe("fakeResponse", () => {
  it("reports ok for 2xx and not for 304", () => { /* ... */ });
  it("exposes an etag only when one was given", () => { /* ... */ });
  it("returns the body from json() and text()", () => { /* ... */ });
});

describe("stubFetch", () => {
  it("records every request it saw, in order", () => { /* ... */ });
  it("records the headers and the body the caller sent", () => { /* ... */ });
  it("finds the requests that mention a fragment of the URL", () => { /* ... */ });
  it("puts the real fetch back when restored", () => { /* ... */ });
});
```

**Then:** implement `client/src/test/requests.ts`:

```ts
export function fakeResponse(body: unknown, init?: { status?: number; etag?: string | null }): Response
export function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): FetchStub

export interface FetchStub {
  calls: RecordedRequest[];
  last(): RecordedRequest | undefined;
  to(fragment: string): RecordedRequest[];
  restore(): void;
}
```

`stubFetch` returns a **stub**, not a bare teardown function: the recorded
calls are the assertion surface, and a bare function would hide them. It
records the URL, the method, the lower-cased headers and the body, so a test
can assert that a request carried the profile header or the session token.

`restore()` is idempotent, and `vi.unstubAllGlobals()` is the backstop for a
test that forgets to call it — the helper must not fight Vitest's own
teardown.

**Note (implemented):** the helper's own test file is the first thing under
`client/src/test/` that is not the Vitest setup file, so it also proves that
directory is not swallowed by `.gitignore` (the bare `test/` pattern used to
match it at any depth).
```

**Then:** implement `client/src/test/requests.ts` with the two helpers.


`stubFetch` installs a `vi.stubGlobal("fetch", …)` and returns a teardown
function. It must record every call so a test can assert on the request.

**Verify:** `cd client && npm test -- requests`

**Definition of done**
- [x] The helper file exists and is covered by its own test.
- [x] `stubFetch` records every call and can restore the real `fetch`.
- [x] No existing test file is changed yet — that happens in step 1.3.
- [x] The helper's own test passes under `--sequence.shuffle`, so it has no
      order dependency.

---

## Phase 1 — Client: one request interface

> **Candidate 01.** `client/src/lib/api.ts:475-491` already says it: *"the app
> has ~8 near-identical private `request` helpers … the test passed and proved
> nothing."* The safety of a request depends on a global `window.fetch` side
> effect installed in `main.tsx:10`, and each call site picks a different
> idiom with a different set of guarantees.

### Step 1.1 — Name the guarantees

**State on entry:** Phase 0 merged.

**Files:**
- `client/src/lib/request.ts` — **new**, the interface
- `client/src/lib/request.test.ts` — **new**

**Test first:** `client/src/lib/request.test.ts`. The interface has exactly
five guarantees, and each gets a test that **fails** before the module
exists:

1. **Bounded.** A request to a host that never answers rejects within the
   timeout rather than hanging forever.
2. **Authenticated.** The session header is attached (native shell) or the
   cookie travels (`credentials: "include"`).
3. **Profile-scoped.** `x-profile-id` is attached.
4. **One error vocabulary.** A failed request throws the reviewed sentence for
   the server's error code, from `copy.ts` — never the server's prose.
5. **Offline-aware.** In explicit offline mode the request refuses rather
   than hanging.

```ts
// client/src/lib/request.test.ts (sketch)
describe("request", () => {
  it("gives up on a server that never answers", async () => { /* fake fetch never resolves */ });
  it("sends the session header in the native shell", async () => { /* ... */ });
  it("sends the profile header", async () => { /* ... */ });
  it("throws the catalogued sentence for a failure code", async () => { /* ... */ });
  it("refuses in explicit offline mode", async () => { /* ... */ });
});
```

**Then** implement `client/src/lib/request.ts`:

```ts
export interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
  keepalive?: boolean;
}
export async function request<T>(path: string, options?: RequestOptions): Promise<T>
export async function requestRaw(path: string, options?: RequestOptions): Promise<Response>
```

It composes the pieces that already exist — `boundedFetch`, `apiUrl`,
`sessionHeaders`, `responseErrorText` — and owns nothing new. `request`
returns parsed JSON (or `undefined` on 204); `requestRaw` returns the
`Response` for the few callers that need the body as a stream, and does **not**
throw on a failure, because a conditional GET treats a `304` as "nothing
changed" rather than as an error.

`keepalive` is an option because the progress saver needs it: the browser
cancels in-flight requests on navigation, and the final save is exactly the
case where the app is being closed.

**Note (implemented):** `sessionHeaders()` already carries the profile
header, so `request` uses it rather than `profileHeaders()` — one call, and
the session header is attached explicitly rather than depending on the global
fetch shim. The shim checks for the header before adding its own, so nothing
is duplicated.

**Note (implemented):** the shared `stubFetch` helper from step 0.2 had to
learn to honour the abort signal, or the deadline guarantee would have been
untestable — a stub that ignored the signal makes every timeout look like it
passed. It now rejects with an `AbortError`, the way a real `fetch` does.
That change is in step 0.2's helper, with its own tests.

**Verify:** `cd client && npm test -- request`

**Definition of done**
- [x] Five guarantee tests exist and pass.
- [x] Each test fails if the corresponding guarantee is removed (proved two:
      removing `credentials: "include"` failed the authentication test, and
      removing the timeout failed the bounded test — both restored).
- [x] `request.ts` imports no React and touches no DOM.

### Step 1.2 — Point `useLibrary` and `useBrowse` at it

**State on entry:** Step 1.1 merged.

**Files:**
- `client/src/lib/request.ts` — **extended** (see the note below)
- `client/src/lib/request.test.ts` — **extended**
- `client/src/useLibrary.ts`
- `client/src/useBrowse.ts`
- `client/src/App.tsx` (pass the profile id to `useBrowse`)
- their two test files

**Test first:** the existing tests in `useLibrary.test.tsx` and
`useBrowse.test.tsx` already cover the behaviour. Add the tests that assert
the *new* guarantees the interface brings:

```ts
it("asks for credentials, so the session cookie travels", async () => { /* ... */ });
it("reports a failed library load with the catalogued sentence", async () => { /* ... */ });
```

**Then:** delete `conditionalRequest` and `writeRequest` from `useLibrary.ts`
and `request` from `useBrowse.ts`; call the interface instead.

**Note (implemented) — the conditional GET moved into the interface.** The
plan said `useLibrary` "uses `requestRaw` and keeps its 304 handling". On
writing it, that put the rule back where it came from: a private helper in
one hook, re-imposable by the next caller. The 304 rule is not a fact about
the library hook — it is a fact about talking to this server — so it belongs
where every caller can have it. `lib/request.ts` gained `requestConditional`,
and the private helpers are gone from both hooks rather than rewritten.

**Note (implemented) — `useBrowse` takes the profile id.** It used to read
`localStorage` during render to notice a profile switch, which meant it polled
a global for a change it should have been told about. The id now arrives as an
argument, and `App.tsx` passes `activeProfileId` — the session-aware value,
not the raw stored hint. The hook call moved down in `App.tsx` to sit after
`activeProfileId` is defined; `browse` is not used before that point.

**Note (implemented) — a double-encoded body, found and fixed.** The old
private helper took a `RequestInit`, whose `body` is a string, so three call
sites passed `JSON.stringify(...)`. The new interface serialises the body
itself, so those sites would have sent a JSON string containing JSON — the
server would read a string where it expects an object, and the write would
silently do nothing. `RequestOptions.body` is therefore typed `object`, which
makes that a **type error** rather than a bug, and the three call sites now
pass the object. The typecheck gate from step 0.1 is what makes this class
of mistake visible at all.

**Verify:**
```bash
cd client && npm test -- useLibrary useBrowse
cd client && npx tsc -b
```

**Definition of done**
- [x] The private helpers are gone from both files.
- [x] Both hooks still pass their existing tests unchanged.
- [x] `useBrowse.ts` no longer reads `localStorage` during render (line 52) —
      the profile id arrives as a parameter instead.
- [x] The credentials guarantee is proven: both hooks' new tests failed with
      `expected undefined to be 'include'` before the move, and pass after.
- [x] The double-encode guard is proven: reintroducing `JSON.stringify` at a
      call site made `tsc` fail with `Type 'string' is not assignable to type
      'object'`.

### Step 1.3 — Move the components onto it

**State on entry:** Step 1.2 merged.

**Files:**
- `client/src/components/ReviewQueue.tsx`
- `client/src/components/TagManager.tsx`
- `client/src/components/AudiobookDetail.tsx`
- `client/src/components/ProfileSwitcher.tsx`
- `client/src/components/ChapterPlayer.tsx` (progress and session saves only)
- `client/src/components/Settings.tsx`, `client/src/components/ServerSetup.tsx`
  (the two health checks)
- `client/src/components/PasswordSettings.tsx` (the last `apiFetch` caller)
- `client/src/components/ProfileSwitcher.test.tsx` — **new** (it had none)
- `client/src/lib/api.ts` — delete `apiFetch` and `apiAssetUrl`
- `client/src/lib/api.test.ts` — the tests that moved with them

**Test first:** for each component, one test that fails without the change:

- `ProfileSwitcher.tsx:39` has **no timeout and no `try/catch`** — a failing
  profile load throws an unhandled rejection. Write a test that makes
  `/api/profiles` reject and asserts the component shows the catalogued
  error rather than crashing.
- `AudiobookDetail.tsx` has three raw fetches; write a test that asserts a
  failure surfaces the error sentence.

**Then:** replace each raw `fetch` with `request()` / `requestRaw()`. Delete
`apiFetch` (one caller, `PasswordSettings.tsx:49` — move it to `request()`)
and `apiAssetUrl` (zero callers).

**Note on `ChapterPlayer`:** the progress save at line 219 uses
`keepalive: true`, which must survive the move. `request()` needs a
`keepalive` option — add it in step 1.1 if it is not there.

**Note (implemented) — the interface resolves absolute URLs.** `Settings` and
`ServerSetup` probe an address the listener just typed, which is not the
configured server. `apiUrl` would have prepended the base to it and produced
`http://server:3000http://server:3000/api/health`. The interface uses
`resolveApiRequest`, which passes an absolute URL through untouched, and a
test pins that.

**Note (implemented) — `CoverImage` deliberately keeps its own fetch.** It
reads the response as a **blob**, not as JSON, and it is the one path that
talks to a media URL with a token in the query string. It was not on this
step's list and it is not broken, so it stays as it is.

**Note (implemented) — two behaviours were tightened rather than copied.**
`AudiobookDetail.apply` used to check `res.ok` and do nothing on a failure,
which left a button that looked like it had worked; it now shows the error.
`ProfileSwitcher.load` had no `try/catch` at all, so a failure was an
unhandled rejection — Vitest reports those as errors that fail the whole
run, which is exactly what `LIMITATIONS.md` §5 warns about.

**Note (implemented) — `apiFetch`'s tests moved rather than vanished.** The
profile header, the credentials, the catalogued sentence and the two
fallbacks all moved to `request.test.ts`. The two fallback tests — the
non-JSON body and the unknown code — had no equivalent there and would have
been lost.

**Verify:**
```bash
cd client && npm test
cd client && npx tsc -b
make check-copy
```

**Definition of done**
- [x] No component in the list calls `fetch` directly.
- [x] `apiFetch` and `apiAssetUrl` are deleted and nothing imports them.
- [x] `keepalive` still reaches the server on the progress save.
- [x] `ProfileSwitcher` has a test file, and its unhandled rejection is gone.
- [x] `apiFetch`'s two fallback tests moved to `request.test.ts`.
- [ ] The whole client suite is green.

### Step 1.4 — Give the admin client its own request module

**State on entry:** Step 1.3 merged.

**Why:** `client/src/admin/main.tsx` is a **separate application** with its
own `copy.ts`, its own bundle and its own origin. It has 16 raw `fetch` calls
and a 1.2 KB test file that tests almost nothing.

**Files:**
- `client/src/lib/bounded.ts` — **new** (the deadline rule, shared)
- `client/src/lib/bounded.test.ts` — **new**
- `client/src/lib/api.ts` — `boundedFetch` now delegates to it
- `client/src/admin/request.ts` — **new**
- `client/src/admin/request.test.ts` — **new**
- `client/src/admin/app.tsx` — **new** (the screens, split out of the entry)
- `client/src/admin/app.test.tsx` — **new**
- `client/src/admin/main.tsx` — now just the mount

**Test first:** `client/src/admin/request.test.ts` — the admin panel talks to
`/api/admin/*` with `credentials: "include"` and needs no profile header and
no session header (it has its own credential). Assert that, and that a failed
request throws an error carrying the server's code and status.

**Then:** implement `admin/request.ts` as a small sibling of `lib/request.ts`.
Do **not** import `lib/request.ts` into the admin bundle — the admin app is a
separate door with a separate credential, and coupling them would drag the
family client's session logic into it.

Then move all 16 call sites, and write the admin tests that are missing
(status dashboard, DB table list, API docs).

**Note (implemented) — the deadline rule moved to `lib/bounded.ts`.** The
admin panel needs the deadline, and `lib/api.ts` carries the family's session
handling, the listener's copy catalogue and the private cache. So the deadline
became `lib/bounded.ts`: a module with no application state in it, which both
bundles import. `lib/api.ts`'s `boundedFetch` now composes it with the
family's offline-mode check.

**Note (implemented) — the deadline got stronger.** The old rule aborted the
signal and relied on the fetch honouring it. The new one aborts **and** races
the promise against the timer, so the call rejects even if the underlying
fetch ignores its signal. Relying on the abort alone would have meant the
deadline was only as good as the fetch implementation — and a fetch that
ignores its signal is exactly the hang the deadline exists to prevent. The
outer signal now rejects the call too, rather than only aborting it.

**Note (implemented) — the entry and the screens were split.** The panel's
screens were not exported and the file ended in a `createRoot` call, so no test
could render them: the admin suite could not reach the panel's behaviour at
all. `admin/app.tsx` now holds the screens and `admin/main.tsx` is just the
mount. The built bundle is byte-identical (`index-CJY7DUMZ.js`), so the split
changed nothing about what ships.

**Note (implemented) — one `fetch` stays.** The upload to object storage is a
raw fetch on purpose: it goes to a different host, with a signed URL of its
own, a binary body and no admin credential.

**Verify:**
```bash
cd client && npm test -- admin
make check-copy
```

**Definition of done**
- [x] `admin/app.tsx` contains no direct `fetch` call except the object
      storage upload.
- [x] The admin bundle does not import `lib/api.ts`. A test asserts it, over
      every file in `admin/`.
- [x] The admin suite covers the status dashboard and the DB table list.

### Step 1.5 — Retire the fetch shim's leftovers

**State on entry:** Step 1.4 merged.

> **The premise of this step was wrong, and the step was rewritten.**
>
> The plan said: "once every call site goes through `request()`, the shim is a
> global side effect that duplicates what the interface now owns" — and then
> to delete it.
>
> That is not true yet. **~30 call sites still call `boundedFetch` directly**
> — `AccountGate`, `ProfileGate`, `ProfileRegistration`, `SessionSettings`,
> `DeviceUnlockSettings`, `AccountMenu`, `lib/passkeys.ts`, `local/device.ts`,
> `local/useDeviceLibrary.ts` — and the shim is what makes them resolve the
> base URL, carry the session header and send credentials. Deleting it would
> break the native shell on every one of them.
>
> So the step was rewritten to do the part that is true and safe: **make the
> request own its guarantees**, so the shim stops being what makes a request
> *work* and is left with only what only a global patch can do. Deleting the
> shim outright is **step 1.6**, once the last raw call sites have moved.

**Why:** `installApiBaseUrl` monkey-patches `window.fetch`. It used to be the
thing that made a request *correct* — resolving the base URL, attaching the
session token, setting the credentials — which made the guarantee a property
of the environment rather than of the call. A module that used `boundedFetch`
was right only because something else had run first.

**Files:**
- `client/src/lib/api.ts`
- `client/src/lib/boundedRequest.test.ts` — **new**
- `client/src/lib/apiFetchShim.test.ts`

**Test first:** a bounded request must be correct with **nothing installed**.
`client/src/lib/boundedRequest.test.ts` asserts that a bounded request
resolves the path against the configured server, asks for credentials,
attaches the session header in the native shell, and leaves an absolute URL
alone — all without the shim.

**Then:** move those guarantees from the shim into `boundedFetch`. The shim
keeps the two things only a global patch can do: the raw call sites that have
not moved onto the interface (the cover fetcher and the reachability probe),
and the "the server stopped answering" report, which has to see *every*
request.

**Note (implemented) — the session header stayed in the shim.** Removing it
broke a test, and the test was right: the reachability probe reads "401" as
"the server is there and wants a password", so without the session header the
native shell would decide it was signed out when it was not. The probe is
one of the two raw call sites, so it still needs the shim.

**Note (implemented) — the inverted test.** The plan asked for "a request that
bypasses `request()` must fail once the shim is gone". The stronger and
achievable version is: **a bounded request must be correct without the shim
installed at all**. That is now a test.

**Verify:**
```bash
cd client && npm test
cd client && npx tsc -b
```

**Definition of done**
- [x] A bounded request resolves its URL, carries credentials and carries the
      session header **without** the global patch.
- [x] The shim is no longer what makes a request correct.
- [x] The shim still does what only a global patch can do: the unreachable
      report, and the two raw call sites.
- [x] The native shell is unaffected — `npm run build:android` succeeds, and
      the reachability probe still tells "signed out" from "server gone".
- [ ] The shim is deleted. **That is step 1.6**, and it is not done yet.

### Step 1.6 — Delete the fetch shim

**State on entry:** Step 1.5 merged.

> **Not done yet, and deliberately.** This is the step the original plan had
> at 1.5, and it is still ahead. It cannot happen until the last raw call
> sites have moved.
>
> What must move first:
>
>  - the **reachability probe** (`lib/reachability.ts:48`), which makes a raw
>    `fetch` and needs the session header to tell "signed out" from "server
>    gone". It should use `boundedFetch` with its own 10-second deadline, or
>    `requestRaw` with a timeout.
>  - the **cover fetcher** (`local/CoverImage.tsx:306`), which reads the
>    response as a blob. It needs the media token in the query, and it must
>    not carry the family's session header to a media URL.
>
> The unreachable report has to move too. Today the shim is the one place that
> sees *every* request, including ones nobody wrote. Once the two raw call
> sites are gone, the report belongs to `boundedFetch` — which sees every
> request the app makes — and the shim has nothing left to do.
>
> **Then** delete `installApiBaseUrl` and its call in `main.tsx`, and delete
> `apiFetchShim.test.ts`'s shim block, keeping the `resolveApiRequest` tests.

**Definition of done**
- [ ] `window.fetch` is not monkey-patched.
- [ ] Every app request still carries credentials and the session header.
- [ ] The unreachable report still fires, and the app still re-probes.
- [ ] `npm run build:android` succeeds.

---

## Phase 2 — Client: one offline key format

> **Candidate 02, part 1.** This is a **live bug**, not friction.
> `privateCache.ts:439-452` keys progress by bare book id
> (`"progress", "7"`), while replica rows are keyed `serverId#bookId`
> (`replica.ts:52`). Spec 30 made the device library a union of per-server
> shelves, so two servers each holding book #7 overwrite each other's resume
> position.

### Step 2.1 — Prove the collision

**Then:** nothing yet. This step only proves the bug exists.


**State on entry:** Phase 1 merged.

**Why:** every fix needs a test that fails first. This one must fail for the
right reason.

**Files:**
- `client/src/local/privateCache.test.ts` — extend
- `client/src/local/replica.test.ts` — extend

**Test first:**

```ts
describe("cacheProgress", () => {
  it("keeps two servers' progress for the same book id apart", async () => {
    await cacheProgress(7, { position: 100, completed: false, lastPlayed: "" }, "https://a.example");
    await cacheProgress(7, { position: 900, completed: false, lastPlayed: "" }, "https://b.example");

    expect((await readProgress(7, "https://a.example"))?.position).toBe(100);
    expect((await readProgress(7, "https://b.example"))?.position).toBe(900);
  });
});
```

This **fails today**: the second write overwrites the first, because both use
the row key `"7"`.

**Verify:** `cd client && npm test -- privateCache` — the new test must fail,
and the existing tests must still pass.

**Definition of done**
- [ ] The new test exists and fails for the stated reason.
- [ ] Nothing else changed yet.

### Step 2.2 — Give the private cache a server-scoped key

**State on entry:** Step 2.1 merged.

**Files:**
- `client/src/local/privateCache.ts`
- `client/src/local/privateCache.test.ts`
- `client/src/components/ChapterPlayer.tsx` (the three call sites)
- `client/src/local/useDeviceLibrary.ts` (the reader)
- `client/src/useBrowse.ts` (favourites)

**Test first:** the step 2.1 test, now passing.

**Then:** add a `serverId` parameter to `cacheProgress`, `readProgress`,
`cacheFavourites` and `readFavourites`. Build the row key with
`replicaBookKey(serverId, bookId)` — the **same function** the replica uses,
so there is one key format in the codebase.

**Migration:** an existing device has progress rows under the old bare-id key.
Reading must fall back to the old key when the new one is absent, or a
listener loses their position after the upgrade. Write the fallback, then
delete the old row after a successful read.

```ts
// Read the new key; on a miss, read the legacy key and migrate it forward.
```

Favourites are per **profile**, not per server, but they are per **server's**
catalogue — a favourite id means a different book on a different server. Give
them the same treatment: one key per server.

**Verify:**
```bash
cd client && npm test -- privateCache replica
cd client && npx tsc -b
```

**Definition of done**
- [ ] The step 2.1 test passes.
- [ ] A progress row written before the upgrade is still readable, and is
      rewritten under the new key.
- [ ] `replicaBookKey` is the only place the key format is written.
- [ ] `App.tsx:407,410` no longer writes the key format inline.

---

## Phase 3 — Client: the library source seam

> **Candidate 02, part 2.** `useLibrary` and `useDeviceLibrary` are two
> implementations of one concept with no shared interface, and `App.tsx:404-414`
> merges them by hand. Two adapters justify the seam: the server shelf and the
> device shelf.

### Step 3.1 — Define the interface and the merge

**State on entry:** Step 2.2 merged.

**Files:**
- `client/src/local/librarySource.ts` — **new**
- `client/src/local/librarySource.test.ts` — **new**

**Test first:**

```ts
describe("mergeShelves", () => {
  it("prefers the server book when both shelves hold the same key", () => { /* ... */ });
  it("keeps a device book from another server", () => { /* ... */ });
  it("drops the device shelf when the server is reachable", () => { /* ... */ });
});
```

**Then** implement:

```ts
export interface LibrarySource {
  books: Audiobook[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh(): Promise<void>;
}
export function mergeShelves(sources: LibrarySource[], offline: boolean): Audiobook[]
```

The merge uses `replicaBookKey` and nothing else.

**Verify:** `cd client && npm test -- librarySource`

**Definition of done**
- [ ] The interface and the merge are tested.
- [ ] The merge prefers the server copy on a key collision.
- [ ] The merge keeps a device book belonging to a different server.

### Step 3.2 — Make both hooks satisfy it

**State on entry:** Step 3.1 merged.

**Files:**
- `client/src/useLibrary.ts`
- `client/src/local/useDeviceLibrary.ts`
- `client/src/local/useDeviceLibrary.test.ts` — **new** (the hook is untested
  today)

**Test first:** write `useDeviceLibrary.test.ts` from scratch. It has no test
file, and it wraps the whole offline experience: `refresh`, `isDownloaded`,
`progressOf`, `download`, `remove`, `recover`, `localUrlForTrack`. Its
collaborators (`replica.ts`, `download.ts`) are well tested, so the hook needs
`localDb` and `deviceFiles` to become parameters rather than module constants.

**Then:** have both hooks return an object satisfying `LibrarySource`. Rename
the divergent members — `error` vs `libraryReadError`, `audiobooks` vs
`books` — to one set of names.

**Verify:**
```bash
cd client && npm test -- useLibrary useDeviceLibrary librarySource
```

**Definition of done**
- [ ] `useDeviceLibrary` has a test file covering the seven operations.
- [ ] Both hooks satisfy `LibrarySource`.
- [ ] The member names are identical on both.

### Step 3.3 — Collapse the merge in `App.tsx`

**State on entry:** Step 3.2 merged.

**Files:**
- `client/src/App.tsx` (lines 404-414)
- `client/src/components/ServerLibrary.tsx` (16 props → fewer)

**Test first:** `App.tsx` has **no test file**. Before touching it, write
`client/src/App.test.tsx` with the two tests that describe what the merge
must produce:

```ts
it("shows the server shelf when the server is reachable", () => { /* ... */ });
it("shows the device shelf when the server is not reachable", () => { /* ... */ });
```

**Then:** replace the hand-written merge with `mergeShelves`. The inline key
format at lines 407 and 410 goes away.

**Verify:**
```bash
cd client && npm test -- App
cd client && npx tsc -b
make test-e2e
```

**Definition of done**
- [ ] `App.test.tsx` exists and covers the two shelf modes.
- [ ] `App.tsx` contains no inline key format.
- [ ] E2E still passes.

---

## Phase 4 — Client: the orchestration layer gets a home

> **Candidate 03.** `App.tsx` is 1,134 lines with 20 `useState` and 13
> `useEffect`. `offlineGate.ts`, `backgroundLock.ts` and `reachability.ts` are
> tested pure functions whose **inputs and dispatch** stayed behind in the hot
> spot. The gate ladder's precedence is expressed only by vertical position.

### Step 4.1 — Extract the profile-resolution rules

**State on entry:** Phase 3 merged.

**Why:** `App.tsx:142-149` computes `activeProfileId` and `playerProfileId`
differently **on purpose** — one is the profile whose shelf is shown, the
other is the profile progress is saved under — and only the variable names say
so. Nothing tests it.

**Files:**
- `client/src/lib/profiles.ts` — **new**
- `client/src/lib/profiles.test.ts` — **new**

**Test first:**

```ts
describe("resolveProfileContext", () => {
  it("prefers the session profile over the stored hint", () => { /* ... */ });
  it("falls back to the stored hint in household mode", () => { /* ... */ });
  it("uses the account profile in demo mode", () => { /* ... */ });
  it("keeps the player profile distinct from the shelf profile", () => { /* ... */ });
});
```

**Then:** implement the pure function, then call it from `App.tsx`.

**Verify:**
```bash
cd client && npm test -- profiles
cd client && npx tsc -b
```

**Definition of done**
- [ ] The four rules are tested and named.
- [ ] `App.tsx` holds no profile-resolution ternary.

### Step 4.2 — Extract the refresh-trigger rules

**State on entry:** Step 4.1 merged.

**Why:** six effects race to refresh the same shelf (`App.tsx:504-571`): a
tick, a profile change, window focus, visibility change, a server-reachable
transition, and the mount. The policy of *when* to refresh is entirely in
`App.tsx` and entirely untested.

**Files:**
- `client/src/lib/refreshPolicy.ts` — **new**
- `client/src/lib/refreshPolicy.test.ts` — **new**

**Test first:**

```ts
describe("refreshTriggers", () => {
  it("refreshes when the profile changes", () => { /* ... */ });
  it("refreshes when the window regains focus", () => { /* ... */ });
  it("refreshes when the server comes back", () => { /* ... */ });
  it("does not refresh on a visibility change that was already visible", () => { /* ... */ });
});
```

**Then:** implement the pure decision function and have `App.tsx` consult it.

**Verify:**
```bash
cd client && npm test -- refreshPolicy
cd client && npx tsc -b
```

**Definition of done**
- [ ] The four trigger rules are tested.
- [ ] `App.tsx`'s six effects collapse into one that asks the policy.

### Step 4.3 — Move the background lock

**State on entry:** Step 4.2 merged.

**Why:** `backgroundLock.ts` implements a 3-line predicate. The 39 lines that
actually lock — the visibility listener, the 30-second interval, the
wall-clock recomputation, the wait for playback, `lockLocal()`,
`setOfflineUnlocked(false)`, `setAuthed(false)`, `setSession(null)` — are in
`App.tsx:328-366`. The **sequencing** is the bug-prone part and none of it is
covered.

**Files:**
- `client/src/lib/backgroundLock.ts` — extend
- `client/src/lib/backgroundLock.test.ts` — extend
- `client/src/App.tsx` (lines 328-366)

**Test first:**

```ts
describe("the background lock sequence", () => {
  it("clears the session and returns to the gate", () => { /* ... */ });
  it("waits for playback to finish before locking", () => { /* ... */ });
  it("does nothing while the app is in view", () => { /* ... */ });
});
```

**Then:** move the orchestration into the module as a `useBackgroundLock`
hook, taking the clear-locks callback as a parameter so the module does not
own the app's state.

**Verify:** `cd client && npm test -- backgroundLock`

**Definition of done**
- [ ] The three sequence tests exist and pass.
- [ ] `backgroundLock.ts` owns the lock, not just the predicate.
- [ ] `App.tsx` has no `setInterval` for the lock.

### Step 4.4 — Move the offline gate's inputs and dispatch

**State on entry:** Step 4.3 merged.

**Why:** `offlineGate.ts` is a tested 6-input decision table whose inputs come
from ~70 lines of untested effect (`App.tsx:579-649`) and whose answer is
re-interpreted by ~45 lines of `if (screen?.kind === …)` (`App.tsx:731-776`).
The **dispatch** is the untested half.

**Files:**
- `client/src/lib/offlineGate.ts` — extend
- `client/src/lib/offlineGate.test.ts` — extend
- `client/src/App.tsx` (lines 579-649, 707-821)

**Test first:**

```ts
describe("the offline gate ladder", () => {
  it("shows the splash while the device library is loading", () => { /* ... */ });
  it("shows the unlock screen when a profile is known and the cache is present", () => { /* ... */ });
  it("shows the shell when the listener skipped the unlock", () => { /* ... */ });
});
```

**Then:** make the table return the screen to render, not just a `kind`, and
have `App.tsx` render it. The ladder's precedence becomes a list, not a
sequence of early returns.

**Verify:**
```bash
cd client && npm test -- offlineGate
make test-e2e
```

**Definition of done**
- [ ] The ladder's precedence is in one list.
- [ ] `App.tsx` has no `screen?.kind ===` chain.
- [ ] Every offline screen is still reachable — the E2E offline flow proves it.

### Step 4.5 — Move the session probe

**State on entry:** Step 4.4 merged.

**Why:** `probeServer` (`App.tsx:196-263`) is 68 lines reading six pieces of
state and writing six, calling three modules that each have their own notion
of "who am I". It derives `authed` from the probe **and** from the session
fetch — two sources of truth for one boolean, reconciled only by ordering. The
re-entrancy guard exists because the probe's own failure triggers a re-probe.

**Files:**
- `client/src/lib/useSession.ts` — **new**
- `client/src/lib/useSession.test.ts` — **new**
- `client/src/App.tsx`

**Test first:**

```ts
describe("useSession", () => {
  it("reports unreachable and not-authenticated separately", () => { /* ... */ });
  it("does not re-probe while a probe is in flight", () => { /* ... */ });
  it("does not clear the profile hint when the server is unreachable", () => { /* ... */ });
});
```

**Then:** extract the hook. `App.tsx` reads `session`, `authed` and
`serverReachable` from it.

**Verify:**
```bash
cd client && npm test -- useSession
cd client && npx tsc -b
```

**Definition of done**
- [ ] The three probe behaviours are tested.
- [ ] `App.tsx` has one source of truth for "who am I".

### Step 4.6 — Move the offline-mode flag

**State on entry:** Step 4.5 merged.

**Why:** the offline flag lives in **three** homes — `App.tsx:125-132` (state
plus a ref), `App.tsx:127` (`localStorage`), and `lib/api.ts:55-62` (a
module-level copy initialised from the same key). Three writes must agree
(`App.tsx:652-657` plus the `localStorage` write just after) or `boundedFetch`
rejects requests the UI thinks will work.

**Files:**
- `client/src/lib/offlineMode.ts` — **new**
- `client/src/lib/offlineMode.test.ts` — **new**
- `client/src/App.tsx`
- `client/src/lib/api.ts`

**Test first:**

```ts
describe("the offline mode flag", () => {
  it("is one value, readable from anywhere", () => { /* ... */ });
  it("survives a reload", () => { /* ... */ });
  it("is what the request interface reads", () => { /* ... */ });
});
```

**Then:** one module owns it. `api.ts` reads it; `App.tsx` writes it through
it.

**Verify:**
```bash
cd client && npm test -- offlineMode
cd client && npx tsc -b
```

**Definition of done**
- [ ] `localStorage.getItem("offlineMode")` appears once in the client.
- [ ] The request interface and the UI read the same value.

---

## Phase 5 - Server: one module owns field precedence

> **Candidate 05.** `metadata/precedence.ts` exists, is tested, and **nothing
> in production imports it**. The rule is re-derived at three call sites
> (`scanner.ts:316`, `apply.ts:164`, `run.ts:344`) and re-implemented twice in
> `app.ts` (`1180-1191`, `1476-1495`).

### Step 5.1 — Decide what the chain means now

**State on entry:** Phase 4 merged. ADR 009 is unamended and the code has not moved.

> **Decision needed.** ADR 009 says the precedence is
> `user override > enriched > embedded > filename/folder derived`, and that
> "the scanner and the enrichment applier must both become field-aware". What
> runs today is **last writer wins**: the scanner writes embedded values and
> the applier writes enriched ones, each guarded only by the user override
> set. A rescan therefore overwrites an *enriched* title with the *embedded*
> title, and only a user override survives. There is no `derived` layer in
> production at all.

**Files:**
- `decisions/028-field-precedence.md` — **new**

**What the ADR must answer:**

1. Does "enriched > embedded" mean the scanner must **not** overwrite a value
   that enrichment wrote — which requires the scanner to know which fields
   enrichment owns? Or does it mean enrichment runs after every scan, so the
   last writer is always the enricher?
2. Is the `derived` layer (filename/folder) implemented, or is it dropped from
   the chain?
3. Is `metadataSource === "user"` removed? ADR 009 says it is replaced, but
   `scanner.ts:311` still reads it and **nothing writes it any more** — so the
   legacy freeze it guarded is now unrecoverable.

Write the ADR **before** writing the code. Do not implement first and write
the ADR to match.

**Verify:**
```bash
cd server && npm test -- app
cd server && npx tsc --noEmit
```

**Definition of done**
- [ ] ADR 028 exists and answers all three questions.
- [ ] `LIMITATIONS.md` records the current behaviour if the ADR keeps it.

### Step 5.2 — Move the rule into the module that owns it

**State on entry:** Step 5.1 merged.

**Files:**
- `server/src/metadata/precedence.ts` — extend
- `server/src/metadata/precedence.test.ts` — extend
- `server/src/scanner.ts`
- `server/src/metadata/apply.ts`
- `server/src/metadata/run.ts`
- `server/src/app.ts`

**Test first:** the module gains three functions, each with a test that fails
before it exists:

```ts
it("reports which fields a human has locked", () => { /* ... */ });
it("records an override, and does not record an empty one", () => { /* ... */ });
it("clears the override when a field is cleared", () => { /* ... */ });
```

**Then:** implement them in `precedence.ts` and call them from the three call
sites. Delete the three inline `writable(field)` copies.

**Verify:**
```bash
cd server && npm test -- precedence scanner
```

**Definition of done**
- [ ] `precedence.ts` is imported by production code.
- [ ] The three inline copies are gone.
- [ ] A scanner test proves an enriched title survives a rescan (or the ADR
      says it need not, and the test proves the documented behaviour).

---

## Phase 6 - Server: one list of personal-data tables

> **Candidate 06.** The GDPR export route, the GDPR erasure route and the
> retention purge each name the same set of personal-data tables by hand, in
> two orders, and they already disagree — `webAuthnChallenge` is erased but
> not exported.

### Step 6.1 — One module owns the list and the constant

**State on entry:** Phase 5 merged.

**Files:**
- `server/src/gdpr/personal-data.ts` — **new**
- `server/src/gdpr/personal-data.test.ts` — **new**
- `server/src/app.ts`
- `server/src/auth/service.ts`

**Test first:**

```ts
describe("the personal-data tables", () => {
  it("lists every table that holds personal data", () => { /* ... */ });
  it("is what the export reads", () => { /* ... */ });
  it("is what the erasure reads", () => { /* ... */ });
  it("is what the retention purge reads", () => { /* ... */ });
});
```

**Then:** move the table list and the 24-month retention constant
(`auth/service.ts:962`) into the module. The export, the erasure and the purge
read it.

**Verify:**
```bash
cd server && npm test -- personal-data
cd server && npx tsc --noEmit
```

**Definition of done**
- [ ] The export, the erasure and the retention purge all read the one module.
- [ ] The 24-month retention constant exists in exactly one place.
- [ ] `auth/service.ts` no longer names a personal-data table itself.


### Step 6.2 — Make the list impossible to forget

**State on entry:** Step 6.1 merged.

**Files:**
- `server/src/gdpr/personal-data.test.ts`

**Test first:** a test that reads `server/prisma/schema.prisma`, finds every
model with a `profileId` relation, and asserts each one is in the list.
**This test fails today** — `webAuthnChallenge` is missing from the export.

**Then:** fix the list until the test passes.

**Verify:**
```bash
cd server && npm test -- personal-data
cd server && npm run db:sqlite:check
```

**Definition of done**
- [ ] The export, the erasure and the purge read one list.
- [ ] The schema-guard test passes.
- [ ] `docs/retention.md` names the module as the enforcement point.
- [ ] `docs/roa.md` and `docs/GDPR-REMEDIATION-PLAN.md` are updated in the
      same change, per `AGENTS.md`.

---

## Phase 7 - Server: split the route table

> **Candidate 04.** `buildApp` is the composition root, the auth gate, the
> error handler and all 64 handlers in one function. Six groups already have a
> module that owns the rule — genres, tags, discover, membership, enrichment,
> auth — and the handlers re-implement it inline.

### Step 7.1 — Capture the route table as a test

**State on entry:** Phase 4 merged.

**Why:** this is a mechanical move across 2,046 lines. The safety net is a
test that asserts the route table **is** what it is today, so the move can be
proven to have changed nothing.

**Files:**
- `server/src/app.test.ts` — extend

**Test first:**

```ts
describe("the route table", () => {
  it("registers exactly the routes it registered before the split", () => {
    expect(routesOf(app).sort()).toEqual([ /* the current list */ ]);
  });
});
```

Derive the list from the app's own `onRoute` hook so it cannot drift. This
test is **expected to fail** the first time it is written if the list is
typed by hand — that is how you know the list is real.

**Also in this step**, add the missing Fastify schemas (spec 11 requires
"JSON schemas on all routes"). Do this **before** the split, so each extracted
module arrives with its schema. 35 of the 60 routes have no schema at all; 6
of them take a body and validate none of it:

| Line | Route | Unvalidated body |
|---|---|---|
| 834 | `POST /api/library-roots` | `{ path?, label? }` |
| 859 | `POST /api/scan` | `{ rootId? }` |
| 1937 | `PUT /api/audiobooks/:id/progress` | `{ position?, completed? }` |
| 1964 | `POST /api/audiobooks/:id/sessions` | `{ fromPosition?, toPosition?, speed?, startedAt?, endedAt? }` |
| 2022 | `POST /api/profiles` | `{ name?, color? }` |
| 2145 | `PATCH /api/me` | `{ name?, color? }` |

The progress and session routes are the two that matter most — a position of
`NaN` or a speed of `Infinity` reaches the database today, and the route
clamps it by hand afterwards. The schema makes the clamp unnecessary.

**Verify:**
```bash
cd server && npm test -- app
```

**Then:** derive the expected list from the app's own `onRoute` hook, so the
test cannot drift from the code it is checking.


**Definition of done**
- [ ] The route-table test exists and passes.
- [ ] Every route that takes input has a schema.
- [ ] A malformed body now returns 400, not a 500 or a silent default.

### Step 7.2 — Extract the taxonomy routes

**State on entry:** Step 7.1 merged.

**Files:**
- `server/src/routes/taxonomy.ts` — **new**
- `server/src/routes/taxonomy.test.ts` — **new**
- `server/src/app.ts`

**Test first:** `taxonomy.test.ts` — genres CRUD and tags CRUD, driven
through `inject` against a temp SQLite DB. The same assertions as the
existing `app.test.ts` covers for these routes, plus the tag merge.

**Then:** move the handlers. They call `metadata/tags.ts` and
`metadata/taxonomy-service.ts`, which already own the rules.

**Verify:**
```bash
cd server && npm test -- taxonomy
cd server && npx tsc --noEmit
```

**Definition of done**
- [ ] The taxonomy routes are in their own module.
- [ ] `app.ts` no longer contains a genre or tag handler.
- [ ] The new module's tests pass.

### Step 7.3 — Extract the discover and wishlist routes

**Then:** move the handlers into the new module. They call
`RecommendationService` and `metadata/recommend.ts`, which already own the
rules.


**State on entry:** Step 7.2 merged.

**Files:**
- `server/src/routes/discover.ts` — **new**
- `server/src/routes/discover.test.ts` — **new**
- `server/src/app.ts`

**Test first:** discover pagination, the "already owned" filter, wishlist
add/remove/mark-owned. `RecommendationService` owns the ranking;
`metadata/recommend.ts` owns the maths. The route owns neither.

**Verify:**
```bash
cd server && npm test -- discover
cd server && npx tsc --noEmit
```

**Definition of done**
- [ ] The routes are in their own module with their own tests.
- [ ] The Discover E2E flow still passes.

### Step 7.4 — Extract the library and membership routes

**Then:** move the handlers into the new module, and extract the shared
book-payload builder so every endpoint returns one `contributors` shape.


**State on entry:** Step 7.3 merged.

**Files:**
- `server/src/routes/library.ts` — **new**
- `server/src/routes/library.test.ts` — **new**
- `server/src/app.ts`

**Test first:** the library listing (including the ETag and the 304 path), the
server-library listing with `inLibrary`, add/remove membership, and the
library-root CRUD.

**Note:** the library listing hand-builds its payload at `app.ts:665-694` and
the server-library listing does the same at `app.ts:740-763`. Two copies of
one payload shape — and the `contributors` shape already differs between
them and from `/api/audiobooks/:id`. Extract one payload builder.

**Verify:**
```bash
cd server && npm test -- library
cd server && npx tsc --noEmit
```

**Definition of done**
- [ ] The routes are in their own module.
- [ ] One payload builder produces the book shape.
- [ ] Every endpoint that returns a book returns the same `contributors`
      shape.

### Step 7.5 — Extract the enrichment routes

**Then:** move the handlers into the new module, and route the manual
enrich path through `EnrichmentManager` so it writes the run row and honours
overrides.


**State on entry:** Step 7.4 merged.

**Files:**
- `server/src/routes/enrichment.ts` — **new**
- `server/src/routes/enrichment.test.ts` — **new**
- `server/src/app.ts`

**Test first:** the run/status/review-queue endpoints, and the manual
`POST /api/audiobooks/:id/enrich`.

**Also in this step:** fix the manual enrich route. `app.ts:1062-1080` calls
`runChain` and `storeCandidates` directly, so it does **not** write an
`EnrichmentRun` row, does **not** set `enrichmentStatus`, and does **not**
respect `FieldOverride`s. A user clicking "look up metadata" leaves the book
in a state the background pass will later re-apply over. Route the manual
path through `EnrichmentManager`.

**Verify:**
```bash
cd server && npm test -- enrichment
cd server && npx tsc --noEmit
```

**Definition of done**
- [ ] The routes are in their own module.
- [ ] The manual enrich path writes the run row and honours overrides.
- [ ] A test proves a manual enrich does not overwrite an overridden field.

### Step 7.6 — One table for the demo-mode policy

**State on entry:** Step 7.5 merged.

**Why:** "which routes exist in demo mode" is answered **64 times** in three
mechanisms: 40 inline checks in `app.ts`, 16 through a `demoMode()` closure
in `auth/routes.ts:112`, and 8 in `auth/passkeys.ts:435`. Two of them return
**401** where every other demo route returns **404** (`app.ts:1299,1785`).

**Files:**
- `server/src/auth/demo-policy.ts` — **new**
- `server/src/auth/demo-policy.test.ts` — **new**
- `server/src/app.ts`
- `server/src/auth/routes.ts`
- `server/src/auth/passkeys.ts`

**Test first:** a table-driven test that asserts every demo-hidden route
answers **404**, and that the public-path allowlist and the demo-hidden set
agree.

**Then:** one predicate, used everywhere. The public-path allowlist
(`app.ts:61-83`) is the same knowledge in a third shape — fold it in too.

**Verify:**
```bash
cd server && npm test -- demo-policy
cd server && npx tsc --noEmit
```

**Definition of done**
- [ ] One predicate answers "is this route hidden in demo mode".
- [ ] Every demo-hidden route answers 404. The two 401s are fixed.
- [ ] The public-path allowlist and the demo-hidden set are one table.

### Step 7.7 — Extract the remaining routes

**Then:** move the handlers into their modules. `app.ts` keeps the hooks, the
error handler and the wiring.


**State on entry:** Step 7.6 merged.

**Files:**
- `server/src/routes/progress.ts` — **new**
- `server/src/routes/profiles.ts` — **new**
- `server/src/routes/gdpr.ts` — **new**
- `server/src/app.ts`

**Test first:** progress read/write, session records, history, the profile
CRUD, and the GDPR export/erase pair.

**Verify:**
```bash
cd server && npm test
cd server && npx tsc --noEmit
make test-e2e
```

**Definition of done**
- [ ] `app.ts` holds the hooks, the error handler and the wiring — and
      nothing else.
- [ ] `app.ts` is under 400 lines.

### Step 7.8 — Share the duplicated listener logic

**Then:** extract the shared modules and point both listeners at them.


**State on entry:** Step 7.7 merged.

**Why:** the family listener and the admin listener both implement
library-root upsert and scan-triggering, with different error vocabularies.
ADR 022 wants a separate **door**, not a separate **implementation**.

**Files:**
- `server/src/library-roots.ts` — **new**
- `server/src/scanning.ts` — **new**
- `server/src/app.ts`
- `server/src/admin/app.ts`

**Test first:** one test file for each shared module, exercised through both
listeners.

**Verify:**
```bash
cd server && npm test
cd server && npx tsc --noEmit
```

**Definition of done**
- [ ] Library-root upsert exists once.
- [ ] Scan-trigger-plus-enqueue exists once.
- [ ] The two listeners answer the same codes for the same condition.

### Step 7.9 — Decide the admin proxy's scope

**State on entry:** Step 7.8 merged.

**Files:**
- `decisions/029-admin-proxy-scope.md` — **new**
- `server/src/index.ts`
- `server/src/app.ts`
- `server/src/app.test.ts`

> **Decision needed.** ADR 025 permits the family listener to proxy `/admin`
> **for hosted Render only**. `server/src/index.ts:26` sets
> `adminProxyTarget` **unconditionally**, for every deployment including the
> household one, and `docker-compose.yml` publishes port 3100 by default. So
> the household deployment exposes `/admin` on the family port — a
> supersession scoped to one deployment, applied to all.

**Do not change the behaviour in this step.** Write ADR 029 recording which
deployment the proxy belongs to, then implement it:

- gate the proxy on an env flag that only the hosted compose sets, **or**
- record that every deployment gets it and amend ADR 022 to say so.

The first is the safer reading of ADR 025. Whichever is chosen, the ADR
states it, and the tests cover both states.

**Verify:**
```bash
cd server && npm test -- app
make test-e2e
```

**Definition of done**
- [ ] ADR 029 exists and states the decision.
- [ ] A test proves the family listener has no `/admin` route when the flag
      is off, and proxies when it is on.
- [ ] The E2E admin flow still passes.

---

## Phase 8 — Client: keep copy out of logic modules

> **Candidate 07.** `position.ts` is documented as pure and then returns
> `copy.position.chapterTitle(index + 1)` and three sentences from
> `remainingLabel`. Its test asserts the literal English "Chapter 4", so a
> copy edit is a maths-test failure.

### Step 8.1 — Inject the copy into `position.ts`

**State on entry:** Phase 7 merged.

**Files:**
- `client/src/lib/position.ts`
- `client/src/lib/position.test.ts`
- `client/src/components/ChapterPlayer.tsx`
- `client/src/components/AudiobookDetail.tsx`
- `client/src/components/ProgressTimeline.tsx`

**Test first:** the existing tests assert English strings. Rewrite them to
assert **data**:

```ts
expect(describePosition(book, segments, 3)).toEqual({
  kind: "chapters",
  index: 3,
  chapterNumber: 4,
  // not a rendered heading
});
```

The rewritten test **fails** until `position.ts` stops returning strings.

**Then:** `position.ts` returns data. The components render the words using
`copy.ts`. This is the pattern `biometricFailure.ts:101-110` already uses —
it takes the copy as a parameter, and its callers pass `copy.*`.

**Verify:**
```bash
cd client && npm test -- position
make check-copy
```

**Definition of done**
- [ ] `position.ts` returns no user-facing sentences.
- [ ] Its tests assert data, not English.
- [ ] The rendered text is unchanged — the copy check and the E2E pass.

### Step 8.2 — The same for `browse.ts`

**Then:** `browse.ts` returns the series name and position as data, and the
components render the words.


**State on entry:** Step 8.1 merged.

**Files:**
- `client/src/lib/browse.ts`
- `client/src/lib/browse.test.ts`
- the components that render `seriesLabel`

**Test first:** the same rewrite — assert the series name and position as
data.

**Verify:**
```bash
cd client && npm test -- browse
make check-copy
```

**Definition of done**
- [ ] `browse.ts` returns no user-facing sentences.
- [ ] Its tests assert data.

### Step 8.3 — The local device and download modules

**State on entry:** Step 8.2 merged.

**Files:**
- `client/src/local/device.ts`
- `client/src/local/download.ts`
- `client/src/local/recover.ts`

**Why:** these raise user-facing sentences from deep inside the file layer,
which means the local layer cannot be reused headlessly and its errors are
untestable without the whole 52 KB copy catalogue loaded.

**Test first:** for each error the module raises, a test that asserts an
**error code**, not a sentence.

**Then:** the modules raise codes; the caller maps codes to sentences.

**Note:** this step is bigger than 8.1 and 8.2. If it turns out to be too
large, split it into one step per module. It is last in the phase for that
reason.

**Verify:**
```bash
cd client && npm test
make check-copy
```

**Definition of done**
- [ ] The three modules raise codes, not sentences.
- [ ] Every sentence those modules used to raise still appears in `copy.ts`
      and is still shown.

---

## Phase 9 — Server: the AI feature gets a real seam

> **Candidate 08.** `LLMAdapter` has exactly one implementation and is never
> used as a type. The concrete class is constructed **inside the route
> handler**, so there is no substitution point and no test for the route. The
> prompt embeds `item.filePath` — an absolute server path sent to the model.

### Step 9.1 — Inject the adapter

**State on entry:** Phase 8 merged.

**Files:**
- `server/src/ai/llm.ts`
- `server/src/app.ts`

**Test first:** a test that builds the app with a fake adapter and asserts
the route asks it and returns the answer. **There is no test for this route
today** — grep for `ai-suggest` finds only `app.ts`.

**Then:** add `llm?: LLMAdapter` to `BuildAppOptions`. The route uses the
injected adapter and falls back to `new LMStudioAdapter()` when none is
given, so production is unchanged.

**Verify:**
```bash
cd server && npm test -- ai
cd server && npx tsc --noEmit
```

**Definition of done**
- [ ] The route has a test.
- [ ] The adapter is injectable through `BuildAppOptions`.
- [ ] Production behaviour is unchanged when no adapter is injected.


### Step 9.2 — Stop sending the server path to the model

**State on entry:** Step 9.1 merged.

**Files:**
- `server/src/app.ts` (the prompt at line 1917)

**Test first:** a test that captures the prompt and asserts it contains the
title and the candidates but **not** the file path.

**Then:** drop the path from the prompt. The title and the candidate list are
what the model is asked to choose between.

**Verify:**
```bash
cd server && npm test -- ai
```

**Definition of done**
- [ ] The route has a test.
- [ ] The adapter is injectable.
- [ ] The prompt contains no server filesystem path.
- [ ] AI stays optional: every feature works with the adapter unavailable.

---

## Phase 10 — Server: one home for the provider clients

> **Candidate 09.** LibriVox and Audnexus are provider clients under
> `metadata/`. Open Library and Google Books are provider clients one
> directory up, so `chain.ts:82-96,106-122` re-maps every field to make them
> fit. `enrichment.ts:193` keeps a private `similarity` that
> `metadata/types.ts:100` was written to replace — so those two providers
> score matches with a **different function** than the other two.

### Step 10.1 — Move the clients beside their peers

**State on entry:** Phase 9 merged.

**Files:**
- `server/src/metadata/openlibrary.ts` — **new**
- `server/src/metadata/googlebooks.ts` — **new**
- `server/src/enrichment.ts` — shrink
- `server/src/metadata/chain.ts`
- `server/src/metadata/recommend-service.ts`
- `server/src/metadata/run.ts`
- `server/src/metadata/enrichment.test.ts` → split to match

**Test first:** the existing provider tests move with the code and keep
passing. A move that breaks a test tells you the import was load-bearing.

**Then:** move the two clients under `metadata/`. Delete the dead exports
(`candidateCoverFilename`, `downloadCover`) — `metadata/cover.ts` supersedes
both and says so at line 7.

**Verify:**
```bash
cd server && npm test
cd server && npx tsc --noEmit
```

**Definition of done**
- [ ] Both clients live under `metadata/`.
- [ ] `enrichment.ts` holds no provider client.

### Step 10.2 — One similarity function

**State on entry:** Step 10.1 merged.

**Files:**
- `server/src/enrichment.ts`
- `server/src/metadata/types.ts`
- `server/src/metadata/metadata.test.ts`

**Test first:** a test asserting the confidence a provider candidate gets is
computed by the shared `similarity` — for Open Library and Google Books as
well as LibriVox and Audnexus.

**Then:** delete the private copy in `enrichment.ts:193` and call the shared
one.

**Verify:**
```bash
cd server && npm test -- metadata
cd server && npx tsc --noEmit
```

**Definition of done**
- [ ] One `similarity` in the server.
- [ ] All four providers score with it.

### Step 10.3 — Clean up the ADR 008 artefact

**State on entry:** Step 10.2 merged.

> **Decision needed.** ADR 008 removed Audnexus from the title-driven chain and
> ADR 011 made it an ASIN-keyed lookup for chapter titles. But the provider
> interface still advertises it as a title-driven provider: `ProviderId` in
> `metadata/types.ts:9` lists `"audnexus"`, `PROVIDER_IDS` includes it, and
> `createProviders()` (`chain.ts:156`) still constructs it. The interface
> offers a capability the chain will not use.
>
> ADR 030 records which of three shapes is right: Audnexus leaves
> `MetadataProvider` entirely and the ASIN lookup becomes its own named
> capability; or it stays in the interface with an explicit "not title-searchable"
> flag; or the chain is changed to walk it. The first is the smallest and
> matches what the code actually does.

**Files:**
- `decisions/030-audnexus-provider-role.md` — **new**
- `server/src/metadata/types.ts`
- `server/src/metadata/chain.ts`
- `server/src/metadata/run.ts`

**Test first:** a test asserting `resolveProviderOrder` never returns
`"audnexus"` — this already holds, and the test proves it stays true.

**Then:** `PROVIDER_IDS` still lists `"audnexus"` and `createProviders()`
still constructs it, so the interface advertises a provider the chain will
not walk. Remove it from the *title-driven* list, and keep the ASIN-keyed
chapter lookup as a separate, explicitly-named capability.

**Verify:**
```bash
cd server && npm test -- metadata
cd server && npx tsc --noEmit
```

**Definition of done**
- [ ] The chain's provider list matches what it actually walks.
- [ ] The Audnexus chapter lookup still works (spec 21).

---

## Cross-cutting work

These are small and were found during the review. Each is one commit and can
be done at any point.

| Step | What | Files |
|---|---|---|
| X.1 | The progress-key collision's sibling: **favourites** are keyed per profile, not per server | `client/src/local/privateCache.ts` — folded into step 2.2 |
| X.2 | `reachedSegmentEnd` is tested and unused; `ChapterPlayer.tsx:524-530` re-implements it without the zero-duration guard | `client/src/components/ChapterPlayer.tsx`, `client/src/lib/playback.ts` |
| X.3 | `lib/biometricVault.ts:13` calls `registerPlugin` at module scope, which `local/device.ts:27-31` says has blanked the screen twice | `client/src/lib/biometricVault.ts` |
| X.4 | Dead exports: `apiFetch`, `apiAssetUrl`, `listReplicaAudiobooks`, `countReplicaBooks`, `totalReplicaBytes`, `EMPTY_FILTERS` | folded into steps 1.3 and 10.1 |
| X.5 | `local/transferGuards.test.ts` tests `./device` — a module that does not exist under that name | rename the file |
| X.6 | `mayAdmin` in `server/src/auth/policy.ts` is exported and called from nowhere | delete it |
| X.7 | `AUDIO_EXTENSIONS` is duplicated byte-for-byte in `scan-utils.ts:3` and `scanner.ts:14` | one import |
| X.8 | `metadataSource === "user"` is read at `scanner.ts:311` but nothing writes it | depends on ADR 028 (step 5.1) |
| X.9 | The admin table browser uses `$queryRawUnsafe` with an interpolated `pageSize` and bypasses the allowlist that `read-only-sql.ts` exists to enforce | `server/src/admin/app.ts` |
| X.10 | `admin/app.ts` opens a **second** `better-sqlite3` connection to the same file per request, which ADR 022 rejected | `server/src/admin/app.ts` |
| X.11 | `lib/biometricFailure.ts` matches native error **message strings**, including a regex over an English sentence, with no compile-time contract with the Java plugin | `client/src/lib/biometricFailure.ts` |
| X.12 | The raw `localStorage` profile reads in 8 places bypass `lib/api.ts`'s accessors; `PENDING_PROFILE_KEY` is duplicated in 2 files | `client/src/lib/api.ts` and the callers |

---

## What this plan deliberately does not do

- **It does not add a state library, a router, or a data-fetching library.**
  The problems here are not solved by more dependencies.
- **It does not delete `useBrowse.ts` or `useLibrary.ts`.** They are the
  adapters for the two library sources. They get a shared interface, not a
  replacement.
- **It does not unify the admin client with the family client.** They are
  separate applications with separate credentials and separate bundles. ADR
  022 is explicit about that.
- **It does not implement the `derived` precedence layer.** Step 5.1 decides
  whether it should exist.
- **It does not touch the provider chain's behaviour.** Open Library and
  Google Books are broken (LIMITATIONS §1.1) and Audnexus never applies
  (§1.2). Those are product bugs with their own specs; this plan only moves
  the code.
- **It does not make the scanner faster, or enrichment better.** Those are
  roadmap items 01 and 07 and they have their own finish lines.

---

## Appendix A — the finding, and where the plan answers it

| # | Finding | Step |
|---|---|---|
| 1 | Six request idioms with six guarantee sets | 1.1–1.5 |
| 2 | Progress keyed by bare book id collides across servers | 2.1–2.2 |
| 3 | Composite key format written twice | 2.2, 3.3 |
| 4 | The library source seam is fake | 3.1–3.3 |
| 5 | `App.tsx` is an untested orchestration layer | 3.3, 4.1–4.6 |
| 6 | Offline mode flag in three homes | 4.6 |
| 7 | Profile resolution computed three ways | 4.1 |
| 8 | Refresh policy untested | 4.2 |
| 9 | Background lock orchestration untested | 4.3 |
| 10 | Offline gate dispatch untested | 4.4 |
| 11 | `probeServer` untested | 4.5 |
| 12 | Copy leaks into pure logic modules | 8.1–8.3 |
| 13 | `reachedSegmentEnd` tested and unused | X.2 |
| 14 | `registerPlugin` at module scope | X.3 |
| 15 | Dead exports | 1.3, 10.1, X.4 |
| 16 | Raw `localStorage` reads | X.12 |
| 17 | `app.ts`: 64 routes, 106 inline Prisma calls | 7.1–7.7 |
| 18 | `metadata/precedence.ts` is dead code | 5.1–5.2 |
| 19 | The override rule implemented three times | 5.2 |
| 20 | GDPR tables enumerated three times, disagreeing | 6.1–6.2 |
| 21 | Demo-mode policy in three mechanisms, two wrong codes | 7.6 || 22 | 35 routes without a schema; 6 of them take an unvalidated body | 7.1 |
| 23 | Admin duplicates the family's library-root and scan logic | 7.8 |
| 24 | Admin proxy on the family port in every deployment | 7.9 |
| 25 | `LLMAdapter` has one implementation; the route is untested | 9.1–9.2 |
| 26 | The AI prompt leaks `item.filePath` | 9.2 |
| 27 | Provider clients in two directories | 10.1 |
| 28 | Two `similarity` functions | 10.2 |
| 29 | ADR 008 artefact: `audnexus` still in the provider list | 10.3 |

## Appendix B — commands

```bash
make test                       # everything: copy + typecheck + both suites
make test-server                # server only
make test-client                # client only
make check-copy                 # the interface copy rules
make typecheck                  # after step 0.1
make restart                    # recreate the containers (server changes)
make test-e2e                   # Playwright against the running stack
make verify                     # live enrichment check against ./test

cd server && npx tsc --noEmit   # the typecheck, alone
cd client && npx tsc -b         # the typecheck, alone
cd server && npm test -- app    # one test file
cd client && npm test -- useLibrary
```
**Verify:**
```bash
cd server && npm test -- ai
cd server && npx tsc --noEmit
```

**Verify:**
```bash
cd server && npm test -- personal-data
cd server && npx tsc --noEmit
```

