# Architecture Deepening Plan — audiobook-manager

- **Date:** 2026-11-09
- **Source:** Architecture review — `C:\Users\benle\AppData\Local\Temp\opencode\architecture-review-20261109-1637.html`
- **Method:** improve-codebase-architecture (explore → report → grill → rewrite)
- **Status:** plan created; implementation to follow in the order below

## Position

Top recommendation from the architecture review: **split the server app module**
(`server/src/app.ts`), first cut being **extract the progress mathematics** module.

## Planned actions

### Phase 1 — Server (Strongest signal)

1. **A1 — Extract the progress mathematics** — `Strong` — files: `server/src/app.ts` handlers, `server/src/progress.test.ts`
   - Move pure position/session/completion mathematics out of route handlers into a pure module (proposed: `server/src/progress-math.ts`).
   - Handlers become thin; pure module owns interface + implementation.
   - Tests: unit tests for the pure module; existing route tests stay green.

2. **A2 — Split the app module** — `Strong` — files: `server/src/app.ts`
   - Extract feature modules behind one composition root; move auth gate, error handler, media streaming, serializers into their own modules.
   - Keep ADR 015 error-envelope contract in one module.

### Phase 2 — Client (Strongest signal)

3. **B1 — Consolidate the fetch layer** — `Strong` — files: `client/src/lib/api.ts`, private request copies in hooks/components.
   - One api module built on `boundedFetch`; route all callers through it.
   - Closes documented gap in `LIMITATIONS.md` §5 → update doc in same change.

4. **B2 — Extract the player controller** — `Strong` — files: `client/src/components/ChapterPlayer.tsx`, `client/src/lib/usePlayerSource.ts`.
   - Controller module owns position state + actions; DOM bridge thin; ADR 017 invariant becomes structural.

5. **B3 — Split the App module** — `Strong` — files: `client/src/App.tsx`.
   - Screens + state hooks behind composition seams; preserve ADR 012 player-first ordering and ADR 017 position model.

### Phase 3 — Worth exploring (after Strong items)

6. **C1 — Split the auth module** — `Worth exploring` — files: `server/src/auth/service.ts`, `server/src/auth/*`.
   - Facade over sub-modules; preserve ADR 003/016 semantics.

7. **C2 — Scanner consumes the precedence module** — `Worth exploring` — files: `server/src/scanner.ts`, `server/src/metadata/precedence.ts`.
   - ADR 009: single precedence rule.

## Sequencing

1. A1 → A2 (server)
2. B1 → B2 → B3 (client)
3. C1 → C2 (later)

## Per-action verification (repo rules)

- `npx tsc --noEmit` (server) / `npx tsc -b` (client); vitest suites; `make check-copy`; e2e via `scripts/e2e-wsl.sh` when UI is touched.
- Code + spec/docs in the same change; `LIMITATIONS.md` / handoff updates at end of each work block.

## Open process items

- Create repo-root `GLOSSARY.md` (missing; required by the architecture skill).
- ADR directory drift: skill references `docs/adr/`, repo uses `decisions/`.
