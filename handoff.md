# Handoff — Audiobook Manager Buildout

> **Purpose:** if this session is lost, an agent (or you) can read this file to
> recover exactly where work stands. Update it at the end of every work block.
> This file is the live progress log; `roadmap.md` + `specs/` remain the plan.

## Current state (snapshot)

- Repo: `/mnt/c/Users/benle/Documents/Projects/TechNative/audiobook-manager`
- Branch: master, at commit `5bb9a1a` plus this session's uncommitted work
  (profile uniqueness + seeding + resume fixes — see "Current task").
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
| 04 | progress + listening history | **done** | PlaySession model + migration, PUT/GET progress (clamped, profile-scoped), POST sessions, GET /api/history, ChapterPlayer resume/save/session flush, 20 server tests green. **This session:** fixed periodic 10s save (timer no longer resets on every position tick), player blocks playback with a hint when no profile is selected (was silently losing progress), resume e2e added |
| 05 | playback-experience | **done** | 15s skip, persisted speed, sleep timer incl end-of-chapter, auto-complete, Media Session controls, client tsc errors fixed |
| 06 | chapter-support | **done** | scanner ffprobe chapter extraction for M4B/M4A/MP4, chapters JSON stored, ChapterPlayer unified segments (tracks OR chapters OR full). NOT yet verified against a real M4B (no ffprobe on dev host; verify via docker later) |
| 07 | metadata-enrichment | **done** | Open Library + Google Books candidates with confidence, candidates stored, apply candidate/manual, covers downloaded locally, scanner preserves user overrides, 24 server tests |
| 08 | pwa-packaging | **done** | vite-plugin-pwa autoUpdate SW, manifest standalone, /api NetworkOnly, dev options on, playwright manifest check. TODO: real raster icons, Lighthouse audit |
| 09 | android-wrapper | **partial** | capacitor.config.ts scaffold points at server URL; APK build blocked on Android SDK on user machine |
| 10 | lan-deployment | **done** | @fastify/static serves client/dist w/ SPA fallback, Dockerfile.prod, docker-compose.prod.yml, restart-unless-stopped, media read-only mount |
| 11 | security-hardening | **done** | safePath confinement (symlink-safe) on stream/cover, ID validation, password type check, security playwright project green, COVER_DIR env |
| 12 | ai-features | **done (MVP)** | LLMAdapter + LMStudioAdapter, /api/audiobooks/:id/ai-suggest offline-safe candidate pick |
| 13 | media-tools | **deferred (stretch)** | requires explicit user confirm + backups; not implemented yet |

## Current task

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
- Test commands: `cd server && npm test` (29 tests), `cd client &&
  npm test` (5 tests) + `npx tsc --noEmit`, `npx playwright test`
  (or `--project=security`) from repo root.
- Playwright chromium system deps installed by the user via sudo.
- `e2e/` flows need the dev servers up; server DB is throwaway at
  /tmp/audiobook-e2e.db with collected sample media from `test/`.
  e2e profiles (E2E User / E2E Dup) are created and cleaned by the
  specs themselves; the six household profiles persist.

## Open questions / blockers

- None blocking. Decisions deferred to the user: Android APK build (spec 09),
  M4B verification environment, media tools (spec 13).

## Suggestions for next sessions

- **Commit soon:** this session's fix is complete and tested but uncommitted
  (git status will show ~12 modified/new files). Suggested message:
  `fix: profile-scoped progress resume + unique profile names`.
- Consider a `DELETE /api/profiles/:id` guard so the currently-selected
  profile can't be deleted from under the user (client reloads on delete,
  but the selected profileId in localStorage can point at a deleted row).
- The e2e "resume" test seeds position 500 via the API; a stronger test
  would drive the real audio element (autoplay-permitting Chromium flags)
  and assert the timeupdate-driven saves — spec 04's "play on one device,
  resume in fresh context" is still only partially covered.
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
- **Fixed this session:** `e2e/helpers.ts` login() raced the async auth probe
  (checked for the password box before it rendered) — now waits up to 3s.

## How to resume after a dropped session

1. Read `roadmap.md` for the plan; read this file for current position.
2. `git log --oneline -5` and `git status` to see what landed.
3. Continue the "Current task" section; update this file before ending.
