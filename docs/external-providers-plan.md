# External providers — build plan (spec 39 / ADR 034)

**Status:** Plan, not started. Approved research: [`external-providers-research-2026-11.md`](external-providers-research-2026-11.md); licensing detail: [`buy-links-licensing-research-2026-11.md`](buy-links-licensing-research-2026-11.md); spec: [`specs/39-external-providers.md`](../specs/39-external-providers.md); ADR: [`decisions/034-external-items-and-check-price-buy-links.md`](../decisions/034-external-items-and-check-price-buy-links.md).

**Hard ground rules (do not relitigate during build):**

1. No prices are displayed anywhere. Every paid row is "Check price →".
2. No server-side price storage, no scraping, no price alerts/history.
3. Child profiles (spec 38) see no buy links, no external items, nothing outbound.
4. External items never leave the device.
5. Amazon in the app is an **untagged** link-out. Affiliate tags come only from `VITE_AFFILIATE_*` config; absent config = untagged = identical UX.
6. No server vendor I/O except the one identifier-only lookup in Phase 5. Everything else client-side.
7. Never `intent://`, never `target=_blank` for store links; all store launches go through the `ExternalIntent` plugin (native) or `window.open` (browser).
8. Any copy passes `make check-copy`; the honesty rule applies everywhere: the app never implies it plays store content.

**TDD is mandatory, not aspirational.** See §0 below. Every step below encodes it.

**Verified live facts (2026-11-13), so nothing here is theory:**

- `librivox.org/api/feed/audiobooks?format=json` → **200, no CORS header** ⇒ the WebView/browser cannot call it; the "Free" match goes through `/api/buy-context` (Phase 5).
- `title=` is exact/`^`-anchored (store titles often drop "The", e.g. `Picture of Dorian Gray`); `author=Wilde`-style partial works; `limit` max 500.
- Google Books `isbn:` search is broken platform-wide (Oct 2026); `saleInfo` = ebook-only; anonymous quota = 0 ⇒ unused for prices/Play ids.
- Audible assetlinks.json → 200, App Links verified (`com.audible.application{,.samsung,.universal}`).
- `play.google.com/.well-known/assetlinks.json` → 200, covers Play Store + Play Books.

---

## 0. Mandatory TDD protocol (applies to every phase)

### 0.1 Scope

Applies to **all application code**: client TS/TSX, server TS, pure modules, hooks, components. It does **not** apply to: AndroidManifest/Gradle/PR/XML copy, spec/docs, and the one narrow native class (`ExternalIntentPlugin.java`, §3.4) — native code gets contract tests from the JS side (§3.5) instead of unit tests, because this repo has no JVM test harness.

### 0.2 The loop, per behaviour

1. **Contract first.** Define types/signatures and the public surface (function, component props, route schema) in writing — signatures and doc comments in this plan or in the file header.
2. **Failing test(s) first.** Write the test named after the behaviour it pins (`"rejects HTTP URLs"`, `"shows the AD cue only when a tag is configured"`). No implementation exists yet or the implementation must be reverted first.
3. **Observe red.** Run the file's suite and **see the test fail for the right reason** (no module, wrong shape, wrong value — never an infrastructure error left unfixed; infra errors are fixed, not worked around).
4. **Minimal green.** Implement the smallest thing that passes. No speculative options, no unreachable branches.
5. **Refactor under green.** Rename, extract, dedupe — tests stay green. Test-first makes this step safe; skip it and the design rots.
6. **Expand cases meanwhile.** Each table-driven case is a behaviour, not a "coverage filler". Case-count is not the goal; pinned behaviours are.
7. **Wire + integration.** After the unit loop: wire the module, add a Fastify-inject test (server), an RTL component test (UI), or an E2E spec (flows). Same red→green discipline.

Concretely: a phase is never "implement, then add tests". The diff for each feature commit contains tests **before or with** the code, in dependency order (pure → IO-bound → UI → E2E).

### 0.3 Repo infrastructure used

| Tier | Tooling | Commands (run from repo root; `client/`/`server/` have their own package.json) |
|---|---|---|
| Client unit/component | Vitest + jsdom + `@testing-library/react` + `@testing-library/user-event` + `@testing-library/jest-dom` + `fake-indexeddb/auto` (auto-loaded in `src/test/setup.ts`) | `cd client; npm test` · `npm test -- src/lib/externalStores.test.ts` · `npm run typecheck` |
| Server unit/integration | Vitest + `prisma` test client + Fastify `app.inject()` | `cd server; npm test` · `npm test -- src/routes/buy-context.test.ts` · `npm run typecheck` |
| E2E | Playwright (`e2e/*.spec.ts`) | `npx playwright test e2e/external-books.spec.ts` (stack must be up; `make test-e2e` for full suite) |
| Copy gate | `scripts/check-copy.mjs` | `make check-copy` |
| Whole suite | | `make test` |
| Audit | | `npm audit` in `client/` and `server/` |

### 0.4 Fixtures & mocking policy

- **No live network in unit tests, ever.** LibriVox/Google Books responses are fixture literals checked into the test (shape captured 2026-11-13; see Appendix A). Date-independence: pass timestamps in, never `new Date()` under test.
- **No module mockery for pure modules.** Only network, timers, filesystem, `window.Capacitor`, and `window.open` are mocked. Every other collaborator is the real thing.
- **Fixtures are minimal and real.** A LibriVox fixture carries only the fields the code reads, named from the live capture (`author=Wilde&fields=id,title`). CPU-heavy fixtures are trimmed, never invented field names.
- **Test naming = behaviour.** `describe("parseStoreUrl", …); it("extracts the ASIN from an Audible /pd/ URL", …)`. No `"works"`, `"handles data"`.
- **No snapshot tests** for this feature (they ossify markup; they don't capture behaviour). Assert on roles, accessible names, text with `getByRole`/`getByText`, and route calls.
- **Fake timers** only for the cache TTL test in Phase 5; everywhere else real timers.
- **E2E mocks server edge cases only** (`page.route` for `/api/buy-context`); the app under test stays real; child/adult `x-profile-id` comes from the seeded e2e helpers.

### 0.5 Definition of done per step

- [ ] Tests exist and fail for the right reason (evidence: pasted red output in the commit/PR description or session notes).
- [ ] Tests pass; no `.skip`/`.only`/`xit` left; no `console.warn` added as "temporary".
- [ ] `npm run typecheck` clean in the touched package.
- [ ] `make check-copy` clean if any user-facing string was added or changed.
- [ ] New tests live in the mirrored file (`foo.ts` → `foo.test.ts`) and pass deterministically twice in a row.

**One accepted exception, in writing:** `ExternalIntentPlugin.java` (§3) gets no JVM test; the JS wrapper is contract-tested instead (§3.5), and the plugin is kept so small it can be reviewed line-by-line. Anything larger voids this exception.

### 0.6 Commit discipline

One behaviour per commit, message `feat(external): …` / `test(external): …` matching repo convention, e.g.:

```
test(external): parseStoreUrl rejects unsupported hosts (failing)
feat(external): parseStoreUrl host table and ASIN extraction
```

Tests-first is satisfied even in a single squashed commit if the tests are present; separate test/feat commits make the red state auditable.

---

## Traceability — spec 39 §Acceptance criteria → phases → tests

| # | Spec 39 acceptance criterion | Phase/Step | Test(s) |
|---|---|---|---|
| A1 | Audible URL paste → badge, opens app / Play fallback on device matrix | P1, P4.6, P9 | `externalStores.test.ts` · `ExternalBooks.test.tsx` · `e2e/external-books.spec.ts` · device matrix |
| A2 | Play Books / Kobo / Libro.fm URLs parse and add | P1.3, P4.6 | `externalStores.test.ts` (table-driven) · `e2e/external-books.spec.ts` |
| A3 | External items never reach server (integration) | P2.2, P4.7 | `useExternalItems.test.ts` (no api import) · E2E network assertion |
| A4 | No play/download/sync affordance; no progress UI | P4.1, P4.6 | `ExternalBooks.test.tsx` (absence queries) · copy assertion (§4.1) |
| B1 | Discover sheet renders; LibriVox free row first when matched | P7.1, P7.5, P7.7 | `GetThisBookSheet.test.tsx` · `e2e/buy-links.spec.ts` · `buy-context.test.ts` |
| B2 | Adult-only; child sees no sheet/affordance | P4.7, P7.2, P7.5, P7.7 | component + E2E child sweep |
| B3 | AD cue adjacent per commissionable row when tag set; none when unset | P6, P7.1, P7.5 | `buyLinks.test.ts` · `GetThisBookSheet.test.tsx` |
| B4 | Nothing price-like rendered ever | P6, P7.5 | rendered-output regex denylist test (`$`, `£`, `€`, `was/now`, `lowest`) |
| B5 | Works untagged (all `VITE_AFFILIATE_*` unset) | P0.3, P6.2, P7.5 | `affiliateConfig.test.ts` · `buyLinks.test.ts` |
| B6 | E2E: adult vs child; launch chain | P7.7 | `e2e/buy-links.spec.ts` |
| GDPR | No personal data; privacy notice sentence; docs consistent | P8 | doc checks; no new ROPA rows (manual) |
| Ops | `make test`, `make check-copy`, `npm audit`, Playwright green | P9 | CI evidence |

Unchecked device-matrix boxes in spec 39 are the only criteria permitted to survive this plan; everything testable in CI/jsdom must be green in-repo.

---

## Phase 0 — Baseline, guardrails, spec alignment (0.5 day)

Objective: make the ground true before touching features. Nothing user-visible.

- [ ] **0.1** Spec/ADR alignment — done 2026-11-13 (`specs/39` table rows, ADR 034 decision #9 + consequences, link to this plan). Remaining: sanity-read spec 39 top-to-bottom for contradictions; flag any found in the PR itself.
  - **0.1a (owner gate):** keep `/api/buy-context` (default) or drop the LibriVox live row in favour of paid rows only. If "drop": delete Phase 5.2/5.4 and B1/B-LibriVox criteria; everything else unchanged. **Default: keep.**
- [ ] **0.2** `.env.production.example` gains `VITE_AFFILIATE_LIBROFM`, `VITE_AFFILIATE_BOOKSHOP`, `VITE_AFFILIATE_KOBO`, `VITE_AFFILIATE_BN` (all empty with one-line comments: "empty = untagged, links still work"). Same for `.env.example` if it exists.
- [ ] **0.3** **Write the test first** — `client/src/lib/affiliateConfig.test.ts`:
  ```ts
  it("returns empty config when no VITE_AFFILIATE_* is set", …)
  it("reads each configured tag", …)          // vi.stubEnv per var
  it("never exposes Amazon", …)               // no VITE_AFFILIATE_AMAZON exists
  ```
  → red. Then `client/src/lib/affiliateConfig.ts` → green. Note: `import.meta.env` under vitest — use `vi.stubEnv("VITE_AFFILIATE_KOBO", "123")` and `vi.unstubAllEnvs()` in afterEach; confirm the client's vitest config exposes `VITE_*` (it does by default).
- [ ] **0.4** `AndroidManifest.xml`: add the `<queries>` block (4 packages: `com.audible.application`, `com.google.android.apps.books`, `com.google.android.apps.books.next`, `com.kobobooks.android`, `fm.libro.librofm`; plus one intent `VIEW`/`BROWSABLE` with `https` scheme). **Test:** none (XML); **verify:** `npx cap sync && cd client/android && ./gradlew assembleDebug` green; `git diff` shows only the `<queries>` block.
- [ ] **0.5** `copy.ts` scaffolds `external` and `buyLinks` groups with **unused** keys (sub-keys listed in §4.2/§7.1); `make check-copy` red→green as strings are wired in later phases. Commit them empty now.
- [ ] **0.6** Confirm `e2e/helpers.ts` exposes child + adult seeded sessions; add `addProfileOfRole(page, "child")` if missing (find existing helper by reading `helpers.ts` — extend, don't duplicate).

**Exit:** build green; 0.3 tests green; 0.1 owner sign-off recorded in the PR.

---

## Phase 1 — Store registry + URL parsing (pure) (1 day) — TDD in full

Contract (write this header first, before any test):

```ts
// client/src/lib/externalStores.ts
export type ExternalStoreId = "audible" | "playbooks" | "kobo" | "librofm";

export interface StoreMatch {
  externalId: string;
  /** Canonicalised product URL safe to hand to an intent/Custom Tab. */
  httpsUrl: string;
  /** Human hint recovered from the slug, if any (title-ish). */
  titleHint?: string;
}

export interface StoreDef {
  id: ExternalStoreId;
  label: string;                 // "Audible" — also the badge and AD-cue vendor name
  packageName: string | null;    // null only for kobo (see LIMITATIONS)
  installUrl: string;            // Play Store listing for "Get <store>" fallback
  parseProductUrl(url: URL): StoreMatch | null;
  searchUrl(query: string): string;
}

export const EXTERNAL_STORES: Record<ExternalStoreId, StoreDef>;
export type ParseResult =
  | { ok: true; store: ExternalStoreId } & StoreMatch
  | { ok: false; code: "unsupported-host" | "invalid-url" | "unrecognised-shape" };
export function parseStoreUrl(raw: string, now?: () => number): ParseResult;
export function deslug(slug: string): string;  // "the-picture-of-dorian-gray" → "the picture of dorian gray"
```

- [ ] **1.1 Write the test file first** — `client/src/lib/externalStores.test.ts`. Enumerate these cases (each one `it(...)`), run, watch them fail for "module not found", then implement:

  Audible (10 cases):
  - [ ] `accepts /pd/<slug>/<ASIN> on audible.com` and on `.co.uk`, `.ca`, `.de`, `.com.au` (5 region cases, table-driven).
  - [ ] `keeps the regional host in the canonical URL` (parse co.uk → canonical co.uk url).
  - [ ] `rejects non-product audible paths` (`/dp/…`, `/search?…`, `/pd/` with no ASIN).
  - [ ] `rejects a 9-/11-char ASIN` and `rejects ASIN with invalid charset`.
  - [ ] `extracts titleHint from the slug` (`the-count-of-monte-cristo` → `"the count of monte cristo"`).

  Play Books (6):
  - [ ] accepts `store/audiobooks/details?id=AQAA…`; accepts `store/books/details?id=…` (ebook pages pass through);
  - [ ] drops unrelated params but keeps `id`; `rejects freebook/` paths; `rejects missing id`.

  Kobo (5):
  - [ ] accepts `kobo.com/<region>/<lang>/audiobook/<slug>` (`en`, `fr`, `uk`); stores slug as externalId;
  - [ ] rejects ebook URLs; rejects locale-less URLs; canonical = the original url with query stripped.

  Libro.fm (6):
  - [ ] accepts `libro.fm/audiobooks/<isbn13>-<slug>`; **validates the check digit** (fixtures: `9781705085059` valid; `9781705085058` rejected);
  - [ ] strips hyphens; rejects ISBN-10 rows (`assert buildBuyLinks handles 10→13 later`); `rejects non-isbn`.

  Cross-cutting (8):
  - [ ] `parseStoreUrl("javascript:alert(1)")` → `{ok:false}` (no crash, no fallthrough).
  - [ ] `parseStoreUrl("http://…")` rejected or upgraded? **Decision: upgrade silently to https** (documented) — test it.
  - [ ] `parseStoreUrl("not a url")` → invalid-url; `parseStoreUrl("https://example.com/pd/x/B000000000")` → unsupported-host; `parseStoreUrl("https://librivox.org/x")` → unsupported-host.
  - [ ] `parseStoreUrl` never throws (fuzz mini-table: 10 malformed inputs).
  - [ ] `httpsUrl` never carries credentials/query (except kobo: query stripped).
  - [ ] `titleHint` undefined when slug unparseable — never `""`.
  - [ ] no network: `fetchSpy` not called (vi.stubGlobal("fetch") + assert not called).
  - [ ] search URLs encode: `searchUrl("a b & c")` → `…a%20b%20%26%20c` (table per store).
- [ ] **1.2 Implement** the module. Keep it dependency-free. `EXTERNAL_STORES` is a plain object literal; no class hierarchy.
- [ ] **1.3 Verify**: `npm test -- src/lib/externalStores.test.ts` → green; `npm run typecheck`.
- [ ] **1.4 Review gates**: every accepting case shows its expected `httpsUrl` literal; registry frozen (`Object.freeze`).

**Exit:** ≥ 30 behaviours pinned; zero implementation beyond what tests demand.

---

## Phase 2 — Device store: Dexie v5 + hook (1 day) — TDD in full

- [ ] **2.1 Write DB test first** — extend `client/src/local/replica.test.ts`-style suite as `client/src/local/externalItems.test.ts`:

  ```ts
  import "fake-indexeddb/auto";
  // use a fresh LocalLibraryDatabase per test (unique name) — pattern already in replica.test.ts
  it("adds an external item and lists it", …)
  it("dedupes on store + externalId, preserving the original row", …)
  it("rejects an unparseable URL with a coded error, storing nothing", …)
  it("removes an item", …)
  it("reads rows from a v4 database without data loss after v5 opens", …)   // see 2.5
  ```
  → red (`externalItems` table doesn't exist).
- [ ] **2.2 Extend `db.ts`**: additive `this.version(5).stores({ ...v4Stores, externalItems: "&id, store, createdAt" })`. Leave version 1–4 blocks byte-identical. Export `ExternalItem` interface from `client/src/types.ts` (spec §A). `id` = `crypto.randomUUID()` — inject id for tests or use `expect.any(String)`.
- [ ] **2.3 Implement `client/src/local/externalItems.ts`** (`addExternalItem`, `listExternalItems`, `removeExternalItem`) — parse through `parseStoreUrl`; dedupe query on index; no network. → green.
- [ ] **2.4 Hook test first** — `client/src/local/useExternalItems.test.ts` with Testing Library `renderHook`:
  - [ ] `loads initially empty`, `add inserts and returns item`, `add twice same URL → one row`, `remove deletes row`, `reload re-reads after external mutation`.
  - [ ] **Guard test:** the module's dependency list contains no `../lib/api` import — enforced by a tiny static test reading the file text? No — enforce by code review + a `grep` in the PR; RTL cannot assert import graphs. Record as manual check in the PR description.
- [ ] **2.5 Implement hook** → green. DB upgrade integrity test: write v4 db with one book, then new code opens db and asserts book row + covers survive (reuse pattern from replica upgrade tests if present; else script it in the test).
- [ ] **2.6** `make test-client` green.

**Exit:** coverage of add/list/remove/dedupe/upgrade; no server import anywhere in `local/externalItems.ts` (paste `grep -n "api" client/src/local/external*.ts` showing empty in PR).

---

## Phase 3 — Native plugin `ExternalIntent` + bridge (1 day) — contract-TDD

**3.1 Contract spec (write first, in the file header of the JS wrapper):** Java class exposes `canResolve({url:string, package?:string}) → {value:boolean}` and `launchIntent({url:string, package?:string, chooserTitle?:string, requireApp?:boolean}) → {completed:boolean}`; on native, missing plugin → JS wrapper returns `false`/rejects softly — never throws into the UI; all errors resolve, never reject (UI must never see an unhandled rejection from the bridge).

- [ ] **3.2** **Write JS wrapper + tests first** — `client/src/lib/externalIntent.test.ts`:
  ```ts
  const mkBridge = (impl) => (globalThis as any).Capacitor = { Plugins: { ExternalIntent: impl } };
  it("canResolve returns false when the bridge is absent", …)
  it("canResolve returns false when the plugin is missing", …)
  it("canResolve passes url and package through", …)
  it("launchIntent returns true on completed:true", …)
  it("launchIntent returns false on completed:false (no throw)", …)
  it("launchIntent falls back to window.open when not native", …)   // stub window.open, assert called with url + noopener
  it("never logs the URL to console", …)
  it("window.open fallback opens with _blank and noopener", …)
  ```
  → red (module missing).
- [ ] **3.3** Implement `externalIntent.ts` around the call-time `window.Capacitor.Plugins.ExternalIntent` pattern; PWA branch uses `window.open`. → green.
- [ ] **3.4** Write `ExternalIntentPlugin.java` (no unit tests — the one accepted exception, §0.5): `canResolve` via `ResolveInfoFlags.of(MATCH_DEFAULT_ONLY.toLong())`; `launchIntent` via `ACTION_VIEW` + optional `setPackage` + `FLAG_ACTIVITY_REQUIRE_NON_BROWSER` when `requireApp=true`; chooser wraps with `Intent.createChooser`; catch `ActivityNotFoundException` → `resolve({completed:false})`; no URL logging. Register in `MainActivity.java` before `super.onCreate`, mirroring `BiometricVaultPlugin`. **Verify:** `npx cap sync && ./gradlew assembleDebug` → BUILD SUCCESSFUL; manifest still carries the 0.4 `<queries>`.
- [ ] **3.5** **Contract test (the substitute for native unit tests):** `externalIntent.test.ts` above IS it — plus one manual dev-build check recorded in the PR: `adb logcat -s ExternalIntent` shows zero lines after exercising add-book on a device (proves no logging).
- [ ] **3.6** `launchStoreLink(def, url)` helper in `externalIntent.ts` — the single launch ladder used by BOTH features (P4 and P7):
  1. native + app detected → `launchIntent(requireApp=true)` (buy rows / open-in-store) → false →
  2. `launchIntent()` implicit (App Links) → false →
  3. native: `@capacitor/browser` Custom Tab · browser: `window.open(url)`.
  Tests (same file): `calls plugin with requireApp for buy rows`, `falls back to implicit when requireApp fails`, `falls back to Custom Tab/window.open last`, `uninstalled store path yields Play link in caller (caller test, Phase 4)`.

**Exit:** wrapper green; APK builds; plugin registered; ladder unit-tested both branches (native/browser).

---

## Phase 4 — Feature A UI: external books in the Library (1.5–2 days) — UI TDD

Per-component loop: **write the component test → watch red → build component → green → integrate → component again → E2E.**

- [ ] **4.1 `ExternalBookCard` test first** — `client/src/components/ExternalBooks.test.tsx`:
  - [ ] renders title/author/badge label per store ("Audible" pill) via `getByText`;
  - [ ] badge text comes from registry label, not hardcoded (render all four store items);
  - [ ] **primary CTA says `Opens in {Store}`, never play/resume/listen** (`queryByRole("button", { name: /play|resume|listen/i })` → null);
  - [ ] tapping CTA calls `launchIntent` with resolved httpsUrl + packageName (mock `externalIntent` module with `vi.mock`);
  - [ ] remove flow: first tap → "Remove?" appears; second tap → `remove` called; escape/blur cancels;
  - [ ] no progress affordance, no heart, no favourite (absence queries);
  - [ ] placeholder cover rendered when `coverUrl` is null; `CoverImage` when set (urlCoverKey path — reuse existing, no new cache code).
- [ ] **4.2 `ExternalBooksSection` test first** (same file):
  - [ ] renders nothing when items empty; renders heading "From your other apps" + N cards;
  - [ ] **child session → section absent** (prop `sessionRole="child"`); admin/member render;
  - [ ] hidden while no items (not even heading).
- [ ] **4.3 `AddExternalBookDialog` test first** — new `AddExternalBookDialog.test.tsx`:
  - [ ] open → paste garbage → error message names supported stores, nothing added;
  - [ ] paste Audible URL → preview shows store badge + parsed title hint; confirm → `addExternalItem` called once with parsed data; dialog closes; section shows card;
  - [ ] paste Play Books URL → preview store says Google Play Books;
  - [ ] title/author inputs editable pre-add;
  - [ ] dialog focus trap + Escape close + focus returned to trigger (patterns from existing modal tests — read `Settings.tsx` tests for the house pattern).
- [ ] **4.4 Implement components** → green on all above.
- [ ] **4.5 App.tsx wiring + gate**: compute `canShowExternal = session?.role !== "child"`; render section inside the library tab branch below `<AudiobookGrid>`; add ghost button `copy.external.addButton` ("Own it elsewhere?") in the library toolbar; handlers via hook. **Deliberate:** external items bypass search/filter (§spec 39) — do not touch `applySearch`/`applyFilters`.
  - Component test (append to `App.test.tsx` or new `ExternalLibrary.test.tsx`): adult sees button + section after adding; child sees neither (render with child role session mock).
- [ ] **4.6 `make test-client` green; `npm run typecheck` green; `make check-copy` green.**
- [ ] **4.7 E2E** — `e2e/external-books.spec.ts` (red→green):
  - [ ] seeded adult: open Library → click "Own it elsewhere?" → paste `https://www.audible.com/pd/Some-Book/B08G9PRS1K` → preview → Add → card visible with badge; click CTA with `page.on('popup')` (browser build: expects `window.open` target audible.com URL);
  - [ ] remove card → gone; reload → persists absent (fresh add needed) — and added item survives reload (`reload` re-evaluates Dexie on mount);
  - [ ] child session: button absent, section absent;
  - [ ] direct store-URL add for Play Books + Kobo + Libro.fm (one flow each).

**Exit:** A1–A4 green in CI/E2E; device matrix pending Phase 9.

---

## Phase 5 — Server: ISBN passthrough + `/api/buy-context` (1 day) — TDD via `app.inject`

- [ ] **5.1 ISBN on Recommendation (no schema change):**
  - [ ] First extend an existing failing assertion: `server/src/metadata/recommend-service.test.ts` — add a candidate fixture with `isbn: "9780439023528"`, assert `shape()` output contains it; run → red (shape drops it);
  - [ ] edit `shape()` to include `isbn: candidate.isbn`; type updates (`Recommendation` in client `types.ts`, `Recommendation` server-side in `recommend.ts`/`recommend-service` as declared); passthrough in `publicRecommendations` (verify pass-through is verbatim; it reserialises — add isbn there explicitly if it whitelists keys; it does not — verify by test, not by reading); → green.
  - [ ] Client `types.ts`: `isbn?: string` on `Recommendation`.
- [ ] **5.2 `buy-context` pure module — test first** (`server/src/metadata/buy-context.test.ts`):
  ```ts
  import { findLibrivoxMatch } from "./buy-context";
  // fetch injected; fixtures in Appendix A
  it("matches Picture of Dorian Gray (title without leading 'The')", …);
  it("requires author agreement — rejects same title, wrong author", …);
  it("returns null on empty author input", …);           // author unknown → no row rather than a wrong row? DECISION: null
  it("returns null when upstream errors / times out", …);  // AbortSignal.timeout(8000) stub-able
  it("strips HTML from description (we never display it anyway — we only need id/title/url)", …);
  it("caches per normalised title+author for 5 minutes", …);  // fake timers
  it("never logs the query string", …);
  ```
  → red.
- [ ] **5.3 Implement** `server/src/metadata/buy-context.ts`: normaliser (reuse `normalizeText` from `./types`), LibriVox query builder (`author=<last word of author>&fields=id,title,authors,url_librivox,url_rss&extended=1&limit=20`), matcher (title token-overlap ≥ 0.85 ∧ author last-name token present), cache Map with TTL, 8s deadline, typed result. → green.
- [ ] **5.4 Route — test first** (`server/src/routes/buy-context.test.ts` via `buildApp` + `app.inject`, patterns from `app.test.ts`):
  - [ ] `GET /api/buy-context` without profile auth → 4xx + `profile_required`-family code (match existing convention);
  - [ ] title missing/empty/>200 chars → 400; author omitted → still allowed but `librivox: null`;
  - [ ] upstream 500 → **200 with `{ librivox: null }`** (assert body, assert no 5xx leak);
  - [ ] cache: two identical calls → `fetch` called once (spy);
  - [ ] rate limiter: N rapid calls from one session → 429 (wire into the app's existing rate-limit facility; find it in `app.ts` — if none exists, implement minimal in-route Map counter, 30/min);
  - [ ] URL of upstream contains no user/session identifiers (spy asserts).
  → red; implement `server/src/routes/buy-context.ts`, register in `server/src/app.ts` route table + `app.test.ts` route-inventory snapshot (the test listing all routes gains one entry) → green.
- [ ] **5.5 Docs in the same commit**: `docs/roa.md` Activity 9 purpose line extended; `docs/processors.md` note that sheet lookups reuse this identifiers-only posture; spec 39 keeps "one server dependency" wording.
- [ ] **5.6 `npm test` green; `npm run typecheck` green.**

**Exit:** B1's server half done; no DB migration touched.

---

## Phase 6 — Buy-link builder + affiliate config (0.5–1 day) — pure TDD

- [ ] **6.1 `client/src/lib/isbn.test.ts` first:**
  ```ts
  it("accepts a valid ISBN-13 (9780439023528)", …)          // checksum recomputed in test AND fixture precomputed
  it("rejects a flipped last digit (9780439023529)", …)
  it("accepts valid ISBN-10 (0-306-40615-2) and normalises hyphens", …)
  it("converts 0306406152 → 9780306406157", …)              // fixture with hand-verified math
  it("rejects ISBN-10 with bad check digit", …)             // 0306406153
  it("returns null for garbage input", …)
  ```
  → red; implement → green.
- [ ] **6.2 `client/src/lib/buyLinks.test.ts` first:**
  ```ts
  const base = { title: "The Picture of Dorian Gray", author: "Oscar Wilde" };
  it("emits the LibriVox row first when librivoxUrl is provided, untagged, free", …)
  it("emits 6 paid rows after the free row, stable order", …)
  it("uses ISBN-13 search fallback when isbn absent", …)
  it("drops rows whose id could not be built? never — search fallback always exists", …)
  it("appends affiliate tags only when configured (stub vi.stubEnv)", …)
  it("emits no tags when nothing is configured (B5 untagged mode)", …)
  it("marks only tag-configured rows commission:true", …)
  it("audience copy is never price-like (regex denylist)", …)
  it("encodes query params exactly once", …)
  it("audible row is never tagged even if env vars are set", …)
  ```
  → red; implement `buildBuyLinks` (templates from registry; `commission: true` iff tag present) → green.
- [ ] **6.3 Wire `affiliateConfig.ts` (Phase 0) into the builder; all checks green.**

**Exit:** matrix {isbn ∈ present, absent, invalid} × {affiliate ∈ set, unset} × {librivox ∈ present, absent} covered by explicit cases (12 cells, list them in the test file).

---

## Phase 7 — Feature B UI: "Get this book" sheet (1.5–2 days) — UI TDD

- [ ] **7.1 `GetThisBookSheet.test.tsx` first** — enumerate:
  - [ ] renders one row per enabled content case: free row first + 6 paid rows;
  - [ ] every commissionable row shows "Ad · we may earn a commission" **on the button** (assert `getByRole("button", {name: /Libro\.fm/})`'s accessible name contains the cue — or `within(row).getByText(/we may earn/)`);
  - [ ] zero-config mode: rows render, cues absent, disclosure footer absent;
  - [ ] libvox fetch failure → rows render, LibriVox row absent, **no error text**;
  - [ ] child session: sheet renders null (open prop true, role child → `container` empty);
  - [ ] `fetch` called with `/api/buy-context?title=…&author=…` URL-encoded; never `librivox.org` from the client (vi.stubGlobal fetch spy);
  - [ ] clicking any row calls `launchStoreLink` with requireApp semantics (mock module);
  - [ ] copy denylist: rendered tree contains no `$|£|€|lowest|was |now ` (regex sweep of `container.textContent`);
  - [ ] focus enters sheet, Escape closes, focus returns to trigger.
- [ ] **7.2 Implement `GetThisBookSheet.tsx`** (modal shell per house pattern; `isChild` self-gate; rows via `buildBuyLinks`; fetch on open only; `AbortSignal.timeout(8000)`). → green.
- [ ] **7.3 Discover wiring test explicit**: `Discover.test.tsx` extension — "renders 'Get this book' affordance for adult with isbn passthrough; child sees none"; implement button on `RecommendationCard` + state in `Discover.tsx` (sheet host lives once per section).
- [ ] **7.4 Wishlist rows gain a "Get" icon button** (`WishlistRow`), same sheet, no ISBN (search rows); RTL test.
- [ ] **7.5 `make check-copy`; `npm run typecheck`; `npm test` green.**
- [ ] **7.6 E2E `e2e/buy-links.spec.ts`** (red→green):
  - [ ] `/api/buy-context` route-intercepted → returns canned match for "Dorian Gray" (fixture literal) and canned null for junk;
  - [ ] adult Discover → open sheet → assert free row present, assert cue adjacency via `locator().filter(…)`, assert no text matches price regex;
  - [ ] child session → zero affordances (`getByText("Get this book")` → 0);
  - [ ] click "Check price →" — `page.on('popup')` or request intercept records `audible.com/search`; app stays open.

**Exit:** B1–B6 green in CI.

---

## Phase 8 — GDPR + docs alignment (0.5 day; doc-only, zero TDD exemption abuse)

- [ ] **8.1** `specs/GDPR-privacy-notice.md`: add the link sentence from spec 39; assert by diff.
- [ ] **8.2** `docs/roa.md` Activity 9: purpose line + processor row already lists LibriVox; no new activity; `docs/processors.md` note (same change); `docs/dpia.md`: one screening line; `GDPR-AUDIT.md`: finding line for external providers ("identifiers-only, no prices stored, child-gated").
- [ ] **8.3** `docs/retention.md`: **no change** — write "no change required" line in the PR description so silence is intentional.
- [ ] **8.4** `LIMITATIONS.md` spec-39 row: update to built/device-pending state incl. Kobo `us/en` pin.
- [ ] **8.5** spec 39 checkboxes ticked for CI-verifiable criteria; device boxes await Phase 9 evidence.

**Exit:** docs verifiably consistent (paste diffs in PR); `make test` still green (doc-only).

---

## Phase 9 — Verification + device matrix (1–2 days) — evidence, not vibes

- [ ] **9.1** Full suites: `make test`; `cd client && npm run typecheck`; `cd server && npm run typecheck && npm test`; `make check-copy`; `npm audit` both trees (paste output); `npx playwright test` (all specs — this catches collateral damage in Discover/Browse/Library).
- [ ] **9.2** Android: `npx cap sync && ./gradlew assembleDebug && adb install -r app/build/outputs/apk/debug/app-debug.apk`.
- [ ] **9.3** Device matrix **executed and recorded in spec 39** (2+ devices; API 33/34/35 if available):

  | Store × state | Audible | Google Play Books | Kobo | Libro.fm |
  |---|---|---|---|---|
  | Installed → opens book page | ☐ | ☐ | ☐ | ☐ |
  | Installed → from sheet (requireApp path) | ☐ | ☐ | ☐ | ☐ |
  | Uninstalled → "Get on Google Play" CTA works | ☐ | ☐ | ☐ | ☐ |
  | No store + browser → URL opens in browser | ☐ | ☐ | ☐ | ☐ |
  | Airplane-mode tap → no crash, Custom Tab fails gracefully | ☐ | ☐ | ☐ | ☐ |
- [ ] **9.4** Affiliate param verification: sign-up pages for Awin (Libro.fm), Rakuten (Kobo), Impact (B&N), Bookshop — replace placeholder param names in `affiliateConfig.ts` with documented ones; **this step may legitimately end in "untagged stays"** for any network not yet signed up; nothing breaks either way (B5).
- [ ] **9.5** Regression spot-check: sign in, play, Discover pagination, child Discover exclusion, wishlist save — 5 minutes each on device; any regression reverts to the last green commit on that surface and is fixed test-first before merge.
- [ ] **9.6** If a matrix cell fails: demote that store to `search-URL-only` in the registry (cheapest honest fix) or hide its rows behind config; **never ship a broken deep link**; amend spec 39 rows to match; re-run 7.x tests that assert the templates.

**Exit:** matrix recorded; spec 39 device items ticked; LIMITATIONS final.

---

## Phase 10 — Fast-follows (separate PRs, not this plan)

Share-sheet ingest (`ACTION_SEND` text/plain) · wishlist `isbn` additive column (both Prisma schemas + round-trip tests) · Amazon affiliate on PWA (own ADR + counsel) · Kobo/Audiobooks.com price feeds (approval-gated) · Libby with a library partner · "Get this book" on owned-book detail (gift framing) · `Get this book` on the tablet/desktop web build.

---

## Risks & mitigations

| Risk | Mitigation (and its test) |
|---|---|
| LibriVox `title=` exactness misses | author-first matcher with token overlap; fixtures with real captures (`Picture of Dorian Gray` w/o leading The); wrong-match rejected by author-agreement test |
| `/api/buy-context` flake kills the free row | 8s deadline; cache; upstream failure ⇒ row absent, sheet fine; route test asserts no 5xx |
| `requireApp` intent unsupported by some OEM | implicit fallback then Custom Tab/browser; matrix catches; launching never depends on the plugin resolving |
| Affiliate param drift (Awin/Rakuten rename params) | config-only params; 9.4 verifies; wrong name = untagged = safe |
| Child sees store surface via some new path | gate exists at App **and** sheet/section/dialog level; E2E child sweep asserts across routes; component tests encode absence too |
| Slow JS bundle from new code paths | `externalStores`/`buyLinks` are pure & tiny; no new deps; bundle diff checked in PR |
| Tests pass in jsdom but store launch breaks on device | Phase 9 matrix is the gate; A-criteria device items cannot be "done" in CI |
| `.skip` tests sneak in | §0.5: none permitted; `grep -R "\.skip\|\.only\|xit(" client/src server/src` clean in PR checklist |

## Definition of done (whole plan)

Spec 39 criteria ticked in-repo or explicitly device-scoped; device matrix recorded; no price text anywhere (asserted by rendered-output denylist tests); child gate verified in unit + E2E; GDPR docs consistent with code (CI-tested where mechanisable); `make test`, `make check-copy`, `npm audit`, Playwright green; commit history shows tests landed red before the code (auditable in PR descriptions); LIMITATIONS and spec 39 reflect reality; no new dependencies.

## Appendix A — captured fixtures (2026-11-13)

LibriVox author lookup (`GET https://librivox.org/api/feed/audiobooks?format=json&author=Wilde&fields=id,title&limit=2`):

```json
{ "books": [
  { "id": "71",  "title": "Canterville Ghost" },
  { "id": "365", "title": "Picture of Dorian Gray" }
] }
```

Target record by id (`/api/feed/audiobooks?id=365&format=json&extended=1&fields=id,title,authors,url_librivox,url_rss`) has: `title: "Picture of Dorian Gray"`, authors last_name `Wilde`, `url_librivox`, `url_rss` — the matcher needs exactly those three fields.

Sample URLs (accept): `https://www.audible.com/pd/The-Count-of-Monte-Cristo-Audiobook/B00S2LTCQK` · `https://www.amazon.com/s?k=<ASIN>` (ignored host) · `https://play.google.com/store/audiobooks/details?id=AQAAAACf3Vbd2M&hl=en_US` · `https://libro.fm/audiobooks/9781705085059-fourth-wing` · `https://www.kobo.com/us/en/audiobook/turtles-all-the-way-down-4`.

Sample URLs (reject): `http://audible.com/dp/B00S2LTCQK` · `https://www.audible.com/pd/` · `javascript:alert(1)` · `https://libro.fm/audiobooks/9781705085058-x` (bad check digit) · `https://kobo.com/audiobook/x` (missing region/lang).

ISBN math (hand-verified, test fixtures): `9780439023528` valid-13 (Hunger Games); `9780439023529` invalid-13; `0-306-40615-2` valid-10 ⇒ `9780306406157`; `0-306-40615-3` invalid-10.

Kobo product URL canonical form: `https://www.kobo.com/<region>/<lang>/audiobook/<slug>` (slug is not a stable public id — dedupe on `store+httpsUrl`).
