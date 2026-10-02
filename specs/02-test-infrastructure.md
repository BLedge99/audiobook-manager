# Spec 02 — Test Infrastructure

## Purpose

Stand up the full testing stack so every later feature can be verified
automatically. This is a prerequisite for doing TDD-style specs.

## Behaviour

- **Backend unit/integration:** Vitest. Integration route tests use Fastify
  `inject` against a temporary SQLite database (file per run, cleaned up).
- **Frontend unit:** Vitest + React Testing Library + jsdom. Cover hooks
  (`useLibrary`) and key components (grid, detail, player controls) with a
  mocked API layer.
- **E2E:** Playwright against the real docker-compose stack (client + server),
  with a seeded library root pointed at `test/` sample media.
- **Security project:** a Playwright project + Vitest group dedicated to the
  security suite (spec 11).
- Playwright browsers install locally (`npx playwright install --with-deps`).

## Scripts

- `server`: `npm test`, `npm run test:watch`
- `client`: `npm test`
- root: `npx playwright test`, `npx playwright test --project=security`

## Fixtures

- Use existing LibriVox sample dirs in `test/` for scanner and playback E2E.
- Add tiny synthetic fixtures where needed (a short generated M4B, a malformed
  audio file) under `test/fixtures/`.

## Acceptance criteria

- [ ] `cd server && npm test` runs and passes.
- [ ] `cd client && npm test` runs and passes.
- [ ] `npx playwright test` runs at least one passing smoke flow: load app,
      see library, open a book.
- [ ] Temp DBs and Playwright artifacts are gitignored.
- [ ] `specs/02` document covers how to add tests for a new feature.

## Testing of the testing

- Deliberately break a unit test and an E2E expectation once to confirm they fail.

## Not in this spec

- Security suite contents (spec 11), CI/CD hosting.
