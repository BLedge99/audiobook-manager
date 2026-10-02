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
| 01 | scanner-consolidation | **done** | single scanner module; duplicate deleted; contributor upsert fixed (name+role unique migration); releaseDate/genre ported; pure helpers in `scanner.ts`→`scan-utils.ts` with 6 Vitest tests green; `tsc --noEmit` clean |
| 02 | test-infrastructure | **done** | server Vitest, client Vitest+RTL (jsdom ^25 pin — jsdom 28 breaks on ESM/CJS), Playwright root config (chromium + security projects), smoke + security placeholder E2E green. Chromium deps installed via sudo by user. |
| 03 | user-profiles-auth | pending | |
| 04 | progress + listening history | pending | |
| 05 | playback-experience | pending | |
| 06 | chapter-support | pending | |
| 07 | metadata-enrichment | pending | |
| 08 | pwa-packaging | pending | |
| 09 | android-wrapper | pending | |
| 10 | lan-deployment | pending | |
| 11 | security-hardening | pending | |
| 12 | ai-features | pending | |
| 13 | media-tools | pending | stretch |

## Current task

Spec 03 — Per-User Profiles & Household Auth. Plan: add Prisma `Profile`
model + `ListeningHistory.profileId`, household-password session gate on all
API routes, profile switcher UI, `x-profile-id` header plumbing. Start by
reviewing how the client stores state (see `client/src/useLibrary.ts`) and
where ListeningHistory is currently written.

### Environment notes (important for a fresh session)
- No system Node: use `export PATH=$HOME/node/bin:$PATH` (Node v22.11.0, npm 10.9.0).
- Server + client dev servers are running in the background (server :3000 with
  throwaway DB at /tmp/audiobook-e2e.db, client :5173 with proxy). Logs in
  /tmp/server.log, /tmp/client.log. Restart them if the session was lost.
- Server tests: `cd server && npm test`; client: `cd client && npm test`;
  E2E: `npx playwright test` from root (needs the dev servers running).
- Playwright chromium system deps were installed by the user via sudo.

## Open questions / blockers

- None blocking. Next decision point likely when starting spec 03 (profile
  model shape) or spec 02 remainder (Playwright needs compose stack up).

## Known bugs / quirks discovered while reading code

- `server/src/services/scanner.ts` uses `prisma.contributor.upsert({ where: { id: 0 } ...})`
  which always creates a new row — likely a bug; candidate behaviour to drop or
  fix during consolidation. Needs user/recorded decision.
- `server/src/index.ts` `streamAudioFile`: Content-Length header is a string of
  a number — fine for Fastify, but confirm tests in spec 02.
- Line endings: last commit normalized CRLF on ~30 files (cosmetic, harmless).

## How to resume after a dropped session

1. Read `roadmap.md` for the plan; read this file for current position.
2. `git log --oneline -5` and `git status` to see what landed.
3. Continue the "Current task" section; update this file before ending.
