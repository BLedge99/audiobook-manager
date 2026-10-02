# ADR 005 — Single canonical scanner

## Status
Accepted

## Context
Two scanner implementations exist (`server/src/scanner.ts` and
`server/src/services/scanner.ts`) with divergent behaviour (cover handling,
track creation, chapter detection, update semantics).

## Decision
Consolidate to the existing canonical scanner (`server/src/scanner.ts`); port
any unique correct behaviour (e.g. filename chapter heuristics) into it, delete
the duplicate, and cover grouping/updates with tests.

## Alternatives considered
- **Keep both behind a flag** — doubles maintenance, confusion about truth.
- **Rewrite fresh** — wasteful; canonical one already integrated with routes.

## Consequences
- One code path to secure, test, and extend.
- Behaviour changes (if any) ship in spec 01 with tests.
