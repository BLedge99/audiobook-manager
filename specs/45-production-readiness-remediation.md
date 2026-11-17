# Spec 45 — Production-readiness remediation: claims vs tree (2026-11-17 review)

> **Status: planned.** Written from the 2026-11-17 re-audit of specs 43/44
> (foreign review). Every finding below was verified off the tree before it
> entered this plan: H1–H3 by direct read, the MEDIUMs by spot check. Read
> "How to work this plan" before starting anything.

## Purpose

Specs 43/44 did real work with real care; the audit found its weakness to be
one systematic thing — **claims outrunning reality at the seams nobody
re-examined** — concentrated in deployment and docs. This plan closes the
findings, TDD throughout, keeping spec 43's rule (the tree is green at every
step) and AGENTS.md's own law (if code and spec disagree, one of them is
wrong now — fix it, explicitly).

## Scope

| Phase | Audit finding(s) | Outcome |
|---|---|---|
| 0 | — | Baseline: suites green, audits recorded |
| 1 | H1 | The weekly backup cannot silently succeed on an empty dump |
| 2 | H2 | The SQL console seals credentials by value shape, not key name |
| 3 | H3, M3, L6 | The demo deploy applies its own migrations; node is pinned; OAuth env docs complete |
| 4 | M1, L7 | Retention is one honest story everywhere (7-newest ≈ 49 days) |
| 5 | M2 | The busy_timeout truth is written down; the spec-43 over-claim corrected |
| 6 | M4 | Passkey `login/options` 429 carries `Retry-After` |
| 7 | M5 | The mojibake bytes are restored; zero undecodable sequences remain |
| 8 | L2, L3, L1 | Offline→online sync carries its seam test; ROPA clause added; spec 44 amendment recorded |
| 9 | L4, L5, L6 | Passkey-reset copy honest; lockout counter atomic; `.env.production.example` completes OAuth |
| 10 | L8 | The last un-annotated eslint suppression gains its reason; spec 6.1 claim corrected note |
| 11 | — | Close-out: numbered list, audits, final verification, roadmap item 45 |

Named-and-accepted (recorded, no code): L9 (console side-effect edges), L10
(unordered first-1000 library cap), L12 (no CSP report-to), L13 (over-strip of
future `challenge`/`statehash` columns — the safe direction), L14 (verified not
a defect; `useBrowse` dep note), L15 = M5.

Out of scope: v0.2.0 tagging (needs wall-clock drills); Playwright e2e (WSL
port-forward; `make test-e2e` raises UAC); Appendix-A sync engine; monitoring
service (accepted R1).

## How to work this plan

Same discipline as specs 42/43/44: test first, observed failing where practical;
one step per commit; the tree is green at the end of every step; every phase
ends with a named verify command.

---

## Phase 0 — Baseline

0.1 Both suites green; record counts and the current load-flake watch note
    (scanner suite is unsteady in full runs — re-run alone before touching code).
0.2 `npm audit --audit-level=high` both tiers; both typechecks.
0.3 No code changes. The findings' evidence lines are quoted verbatim in the
    phase that consumes them.

**Definition of done:** green tree, numbers recorded, report untouched.

---

## Phase 1 — the backup cannot succeed on nothing (H1)

**Evidence.** `scripts/backup-db.sh:30`:
`pg_dump "$DATABASE_URL" … | age --recipient "$AGE_RECIPIENT" --output "$DEST"`
under `set -eu` — POSIX sh has no pipefail. A dead/expired/unmigrated database
yields an empty-payload `.age` file with a perfectly valid header, the sha256
prints, retention then keeps the newest seven and deletes a good older dump
in its place. `docs/drills.md` only ever exercised the live path.

### Step 1.1 — pipefail by construction, not by flag

**Test first** (`scripts/backup-db.test.sh`, new): a `pg_dump` stub that
exits 1 makes the script exit non-zero, writes **no** `bookle-*.dump.age`,
and leaves any pre-existing backup untouched; a succeeding stub writes one
non-empty archive and exits 0. (`age` stub: prepends the age magic header.)

**Then:** `scripts/backup-db.sh` becomes `bash`, dumps to a temp file first
(`pg_dump … > "$TMP"`), refuses when the temp is empty, encrypts the *file*
with `age --output` (no pipe), and verifies the archive opens
(`age --decrypt | pg_restore --list` when both tools exist — the runbook's
own literacy path) **before** retention pruning runs. No `pipefail` required;
plain `[ -s "$TMP" ]` beats it.

### Step 1.2 — the restore story says what the script proves

`docs/backup-restore.md` gains: the archive is verified, not assumed; a
synthetic empty-input test (Step 1.1) guards the regression; the drill
caveat unchanged (real-dump verification waits for the first real Sunday).

**Verify:** `bash scripts/backup-db.test.sh` → PASS; suites unchanged.

**Definition of done:** a dead database produces zero files and zero deleted
good dumps; only a verified archive enters the rotation.

---

## Phase 2 — the SQL console seals by value shape (H2)

**Evidence.** `server/src/admin/read-only-sql.ts:42–50` — `stripSecretColumns`
filters output *keys* (case-insensitive). `SELECT "passwordHash" AS digest
FROM "Profile"` returns `{digest: "$2b$10$…"}` on both providers; the
integration test asserts only key-name greps.

### Step 2.1 — bcrypt-shaped values never leave the console

**Test first** (`server/src/admin/read-only-sql.test.ts` + the integration
suite): the alias query returns `{ digest: "[redacted]" }`-shaped output;
`SELECT * FROM "Profile"` still strips named columns; a hex-like non-bcrypt
value is untouched (enrichment has legitimate hashes); existing 202
"credential material never leaves" assertions still pass.

**Then:** a value-shape scrub beside `stripSecretColumns`: any string matching
`^\$2[aby]\$\d{2}\$` (and `^\$argon2(id)?\$`) becomes `"[redacted]"` on both
providers' row output. This is the whole realistic threat — an operator with
admin can read the box anyway; bcrypt shape is the offline-crackable one.

### Step 2.2 — the spec-43 phase-2.1 claim is restored honestly

Both bodies strip credential material in every mode; the test name is
revised to say so; spec 43's row for 2.1 carries a correction line (same
pattern as spec 41's corrections).

**Verify:** `npm --prefix server test` → green incl. new cases.

**Definition of done:** an aliased credential value is indistinguishable
from redaction in the console output.

---

## Phase 3 — the demo deploy applies its own migrations (H3, M3, L6)

**Evidence.** `render.yaml:26` — `startCommand: npm --prefix server run start`
(`node dist/index.js`); no `migrate deploy`. Migration
`server/prisma/migrations/20261116213000_cover_retry_count/` is committed and
referenced by the enrichment queue; without it every pass errors into the
per-item catch, silently. `docs/production-database-access-control.md:69–70`
tells the operator the deploy does it for them. `render.yaml` also pins no
Node version though both tiers declare `engines: node >= 24`.

### Step 3.1 — the deploy migrates, then starts

**Then:** `startCommand: bash -c "npm --prefix server run db:prod:migrate &&
npm --prefix server run start"` (the `db:prod:migrate` script already exists).
Add `NODE_VERSION: "24"`. `docs/production-database-access-control.md` is
corrected to describe the actual command (the doc no longer leads a reader to
believe a deploy quietly fixes schema drift). A tiny config assertion test
(`server/src/render-config.test.ts`): the YAML's startCommand contains
`db:prod:migrate` before `run start`, and `NODE_VERSION` is `"24"`.

### Step 3.2 — .env.production.example completes the OAuth set

L6: production boot throws ("must be set in production when the provider is
configured") without `GOOGLE_REDIRECT_URI`/`GITHUB_REDIRECT_URI`; neither is
in the example file nor its OAuth section. Add them, commented, with a
one-line each.

**Verify:** `npm --prefix server test` (config test); `make local` smoke
optionally; suites unchanged.

**Definition of done:** a fresh demo deploy applies the migration before its
first request; node is pinned; OAuth operators stop getting a boot crash
from undocumented vars.

---

## Phase 4 — one honest retention story (M1, L7)

**Evidence.** ADR 037 ("4 weekly + 3 monthly"), spec 43 Phase 3.1 (same),
`scripts/backup-db.sh:7–13,35–40` (7-newest ≈ 49 days, no monthly logic
anywhere), `docs/retention.md:62–68`, `docs/backup-restore.md:80–83` and
`docs/roa.md:31–34` ("~28 days").

### Step 4.1 — the docs match the script

**Then:** ADR 037 gains an addendum ("as implemented in spec 43 the script
keeps the 7 newest weekly dumps ≈ **49 days**; the two-tier plan was not
built and the tiered documents were corrected in spec 45"); `retention.md`,
`roa.md` and `backup-restore.md` carry **~49 days**; `scripts/backup-db.sh`'s
header comment states 7-newest plainly; spec 45's close-out records it.

### Step 4.2 — the runbook stops double-dumping

`docs/backup-restore.md:31` runs an inline `pg_dump | age` *and then the
script*. The cron example now calls the script only.

**Verify:** doc grep assertions; read-through done once as written.

**Definition of done:** every retention sentence in the repo agrees with
what the script does; a data subject's ~49-day promise matches the file
system.

---

## Phase 5 — the busy_timeout truth (M2)

**Evidence.** `server/src/sqlite-pragmas.test.ts` sets and asserts the
pragma on a hand-opened handle; no connection that matters is ever
configured; `server/src/index.ts:16–33` sets it on a transient startup
handle only (not persisted). Spec 43 Phase 1.2's done-criterion claimed the
assertion proved the behaviour.

### Step 5.1 — write the truth where the next reader looks

**Then:** LIMITATIONS.md gains the honest note (Prisma's SQLite engine has
no busy_timeout knob; WAL + short transactions are the control; a
concurrent progress-save vs rescan race falls back to "best effort,
last-write-wins" — unchanged today's behaviour, now recorded). Spec 43's
Phase 1.2 row gains a correction line (same pattern as spec 41).
No fake test; no knob invented.

**Verify:** docs read; spec-43 row corrected.

**Definition of done:** the spec no longer claims an assertion that proves
nothing; the app states its SQLite ceiling plainly.

---

## Phase 6 — `429` keeps its promise about `Retry-After` (M4)

**Evidence.** `specs/43` Phase 2.5: "burst … → 429 with Retry-After".
`server/src/auth/passkeys.ts:464` returns `fail(reply, 429, "account_locked",
{ retryAfterSeconds })`; `fail()` never sets the header;
`server/src/passkeys.test.ts:400–418` asserts the body only.

### Step 6.1 — set the header where the 429 is sent

**Test first** (`server/src/passkeys.test.ts`): the locked-then-retry call
answers 429 **with** `Retry-After: <seconds>` — asserted, not the body shape.

**Then:** `reply.header("Retry-After", String(retryAfterSeconds))` before the
429 send on the `login/options` lockout path (and the reset step records the
rotation note in the plan).

**Verify:** `npm --prefix server test` green incl. the new assertion.

**Definition of done:** the header exists, is tested, and the spec-43 phase
row is honest.

---

## Phase 7 — the file bytes stop lying (M5)

**Evidence.** `f5eca86` introduced 6 mojibake sites in `client/src/App.tsx`
(em-dashes double-encoded); `bd0f05e` did the same in
`server/src/library-membership.ts:2,20,36`. The "extract-only, zero bytes
improved" claim was not byte-true.

### Step 7.1 — restore and sweep

**Then:** the correct characters are restored (`—` `’` `→`) on all nine
sites; a one-shot grep proves no `â€` remains anywhere in the tree; suites
and lint green.

**Verify:** `grep -r "â€" .` → no hits; `npm --prefix client run lint`
green; suites green.

**Definition of done:** the refactor's claim is true.

---

## Phase 8 — offline→online sync: the seam is pinned, the clause exists (L2, L3, L1)

**Evidence.** `specs/44` mandates `useLibrary.test.tsx` (reconnect flow via
stubbed fetch) — it exists but contains **zero** reconnect cases;
`client/src/useLibrary.ts` calls `void pushStaleProgress(...)` after a
refresh and nothing pins it. The promised `docs/roa.md` clause never landed.
`pushStaleProgress` pushes `position`/`completed` only; the spec's S1 wanted
`lastPlayed`; the server PUT schema carries only `position`/`completed` and
`ListeningHistory.lastPlayed` is `@updatedAt` — server time is the
monotonic authority, and client-supplied ordering is not trusted.

### Step 8.1 — the promised test

**Test first** (`client/src/useLibrary.test.tsx`): after a failed offline
progress save, a subsequent successful refresh results in `PUT
/api/audiobooks/:id/progress` carrying the cached position (stubbed fetch
asserts body), and the orchestration ordering holds.

**Then:** wire `pushStaleProgress` verification if the seam needs it; keep
the flow unchanged (the gap was coverage, not design).

### Step 8.2 — the ROPA clause

`docs/roa.md` Activity 4 gains `… and positions may be written by the client
on reconnect, subject to the server's monotonic rule.`

### Step 8.3 — spec 44 records the divergence itself

Spec 44's S1/Files sections gain an amendment: pushes carry
`position`/`completed` only; `lastPlayed` is server-authoritative
(`ListeningHistory.lastPlayed` is `@updatedAt`); client clocks are not
trusted for the monotonic comparison; the README's promise is unchanged
(position syncs) while server row ordering stays honest under clock skew.

**Verify:** `npm --prefix client test` green incl. the new seam test; doc
grep for the ROPA clause.

**Definition of done:** the seam the spec promised is exercised; the record
knows clients may write; the spec and the code agree in one direction,
deliberately.

---

## Phase 9 — operator-facing honesty fixes (L4, L5, L6 — L6 in phase 3)

### Step 9.1 — the admin reset copy tells the truth about passkeys

`client/src/admin/copy.ts` — the `resetPasswordDone` message gains: the
user's passkeys were removed and must be re-registered.

### Step 9.2 — the lockout pair is one statement

**Evidence.** `server/src/auth/service.ts:742–762` — increment then
conditional `lockedUntil`, two statements. A concurrent unlock landing
between them re-locks the operator's just-unlocked profile.

**Test first:** a locked profile, operator unlocks, a failure lands before
(unlock commits) / after — no lost lockout state in either order; sequential
threshold behaviour unchanged.

**Then:** one `update` with a `CASE`-shaped raw clause or
`$transaction([increment, conditionalWrite])` that sets `lockedUntil` only
when the increment crosses the threshold, atomically per write of its pair.

**Verify:** `npm --prefix server test` green.

**Definition of done:** the interleaving that could re-lock a profile is
not expressible.

---

## Phase 10 — the last unexplained suppression (L8)

### Step 10.1 — ten suppressions, ten reasons

The tenth (this range added one:
`client/src/lib/useSession.ts:76`) gains the same `-- reason:` annotation the
other nine carry; spec 43's 6.1 row carries a correction line noting the
`--reason:` rule was never enforced by CI (the gate is `report-unused`, which
polices *stale* directives, not unexplained new ones). The CI gate stays
as-built; the claim is corrected.

**Verify:** `npm --prefix client run lint` green.

**Definition of done:** every suppression is explained, and the spec's
claim matches the tool.

---

## Phase 11 — close-out

11.1 Every spec file this plan corrected carries its correction note; every
     amendment lives in the file itself (spec 44's S1 amendment rides with
     it; no silent divergences).
11.2 Final verification, record numbers: both audits, both suites, client
     build + bundle budget (`scripts/check-bundle-size.mjs`), `npm audit
     --audit-level=high`, LIMITATIONS for the busy_timeout entry and the
     load-flake note refresh.
11.3 Roadmap item 45 lands (Done with date and one-line summary); the
     re-audit HTML remains in %TEMP% (not committed).

**Effort (rough):** 1–3 × M; 4–10 × S; 11 × S. All phases independently
mergeable after 0.
