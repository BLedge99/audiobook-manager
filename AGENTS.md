# AGENTS.md — Onboarding for AI Agents

Welcome. This file tells you how to understand, navigate, and safely modify this
repository. Read it before touching code.

## What this project is

A local-first audiobook manager for a household. It scans local storage for
audiobook files, extracts/enriches metadata, and serves a Netflix-style browse
and playback experience to a React web client. The client runs on desktop and on
Android (PWA, later a wrapped WebView app). The server will eventually run on a
low-power device (Raspberry Pi).

- `client/` — React + Vite + TypeScript + Tailwind frontend
- `server/` — Node.js + Fastify + Prisma + SQLite backend
- `server/prisma/` — schema and migrations
- `test/` — real LibriVox MP3 sample libraries used for tests/fixtures
- `PRD.md` — what the product is, who it serves, scope
- `roadmap.md` — numbered features in build order, each with a finish line
- `specs/` — one file per roadmap feature; behaviour + acceptance criteria + checks
- `decisions/` — short ADRs explaining big choices and rejected alternatives

## Source of truth order

1. `roadmap.md` — what gets built and in what order
2. `specs/NN-<feature>.md` — how each feature must behave, and when it's done
3. `decisions/` — why major architectural choices were made; do not contradict
   them without writing a new/superseding ADR
4. Code — implements the above; it never redefines them

If code and spec disagree, fix the code or explicitly update the spec in the
same change. Never silently diverge.

## Working rules (always apply)

- **Never auto-write tags/metadata into user media files.** Enrichment results
  live in the app database. Embedding metadata into files is a separate, explicit,
  user-confirmed feature (`specs/13-media-tools.md`).
- **AI is optional.** Every feature must work fully with LM Studio offline.
  AI augments; it never gates core behaviour.
- **File access is guarded.** Any endpoint or scanner path that touches the
  filesystem must confine reads to configured `LibraryRoot` paths. See the
  Security section below and `specs/11-security-hardening.md`.
- **Keep the server stateless-ish and the DB authoritative.** Progress, scan
  state, and history live in the DB so they sync across devices.
- **Prefer small, reviewable changes.** One feature per change, matching a spec.
- **Every feature ships with tests.** See Testing rules and `specs/02-test-infrastructure.md`.
- **Migrations stay additive.** SQLite now, PostgreSQL-compatible later; don't
  use SQLite-only SQL that would block that move.

## How to run things

```bash
make start   # docker compose up (server :3000, client :5173)
make stop
make logs
make scan    # trigger a library scan
make reset   # tear down and rebuild
```

Tests (once `specs/02` lands):

```bash
cd server && npm test        # backend unit/integration (Vitest)
cd client && npm test        # frontend unit (Vitest + Testing Library)
npx playwright test          # E2E + security project
```

## Security rules while building

- All route inputs validated with Fastify schemas — no raw `request.body` use.
- Client supplies **IDs, not paths**. Server resolves paths from the DB and
  verifies the resolved path stays under a configured library root.
- Reject paths containing `..`, encoded traversal (`%2e%2e`), absolute paths
  from the client, and symlinks escaping the library root.
- Range requests bounded and validated; 416 on invalid ranges.
- CORS restricted to known client origins.
- Don't leak absolute server paths in API responses or errors.
- `npm audit` before finishing dependency changes; no secrets committed.

Full requirements: `specs/11-security-hardening.md`.

## Testing rules

- Unit-test pure logic (grouping, parsing, progress math) at both tiers.
- Integration-test every API route via Fastify `inject` with a temp SQLite DB.
- Every roadmap feature's acceptance criteria should map to a test where
  practical; E2E flows live in Playwright.
- Use the real sample libraries in `test/` for scanner tests; never commit
  personal media.

Full requirements: `specs/02-test-infrastructure.md`.

## Adding new things

- New feature? Add/extend a `specs/` file and a `roadmap.md` entry first.
- Big architecture choice (new DB, new framework, auth model change, new
  external service)? Write a short ADR in `decisions/` (`NNN-slug.md`) using the
  same format as the existing ones.
