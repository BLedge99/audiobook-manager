# ADR 001 — SQLite first, PostgreSQL-compatible schema

## Status
Accepted

## Context
The app stores library metadata, progress, history, and candidates. It should
be zero-config on a Raspberry Pi but be able to move to a fuller DB later.

## Decision
Use SQLite via Prisma now, keeping the schema PostgreSQL-compatible (no
SQLite-only column types or raw SQL, JSON columns stored as strings).

## Alternatives considered
- **PostgreSQL from day one** — heavier ops on a Pi; rejected for now.
- **Lite alternatives (LowDB/JSON files)** — no relations/migrations; rejected.

## Consequences
- Concurrency note: fine for a household; plan PostgreSQL if write contention appears.
- JSON-in-string columns need app-level parse/stringify (already the pattern).
