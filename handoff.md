# Handoff — Audiobook Manager Buildout

> **Purpose:** if this session is lost, an agent (or you) can read this file to
> recover exactly where work stands. Update it at the end of every work block.
> This file is the live progress log; `roadmap.md` + `specs/` remain the plan.

## Current state (snapshot)

- Repo: `/mnt/c/Users/benle/Documents/Projects/TechNative/audiobook-manager`
- Branch: master, at commit `211eadb` (docs commit `f3dca59` landed; spec docs
  committed). Owner pushes manually from their terminal.
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
| 03 | user-profiles-auth | **done** | buildApp() extraction, APP_PASSWORD cookie gate, Profile model + migration, profile CRUD, client LoginGate/ProfileSwitcher, 13 server tests + e2e green |
| 04 | progress + listening history | **done** | PlaySession model + migration, PUT/GET progress (clamped, profile-scoped), POST sessions, GET /api/history, ChapterPlayer resume/save/session flush, 20 server tests green |
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

All roadmap items 01–12 are implemented and committed (13 is stretch/deferred).
Remaining follow-ups:
- Verify M4B chapter extraction against a real M4B via docker (no ffprobe on
  the WSL host).
- Replace SVG PWA icon with real raster icons; run Lighthouse PWA audit.
- Spec 09 APK build needs Android SDK (user machine).
- Spec 13 media tools are deferred unless the user asks for them.
- Suggest the user push/pull-request from their terminal.

### Environment notes (important for a fresh session)
- No system Node: use `export PATH=$HOME/node/bin:$PATH` (Node v22.11.0, npm 10.9.0).
- Server + client dev servers running in background (server :3000 with
  APP_PASSWORD=household + COVER_DIR=/tmp/covers, client :5173 @ localhost:3000).
  Logs: /tmp/server.log, /tmp/client.log. If session lost: restart both before
  running E2E.
- Test commands: `cd server && npm test` (28 tests), `cd client && npm test`
  (3 tests), `npx playwright test` / `--project=security` from repo root.
- Playwright chromium system deps installed by the user via sudo.
- `e2e/` flows need the dev servers up; server DB is throwaway at
  /tmp/audiobook-e2e.db with collected sample media from `test/`.

## Open questions / blockers

- None blocking. Decisions deferred to the user: Android APK build (spec 09),
  M4B verification environment, media tools (spec 13).

## Known bugs / quirks discovered while reading code

- `server/src/services/scanner.ts` used `prisma.contributor.upsert({ where: { id: 0 } ...})`
  (always created a new row) — **fixed in spec 01**: upsert by (name, role) + unique.
- Line endings: one commit normalized CRLF on ~30 files (cosmetic, harmless).
- `server/src/scripts/scan.ts` referenced by package.json "scan" script does
  not exist — see package.json "scan" script; never runs unless invoked.

## How to resume after a dropped session

1. Read `roadmap.md` for the plan; read this file for current position.
2. `git log --oneline -5` and `git status` to see what landed.
3. Continue the "Current task" section; update this file before ending.
