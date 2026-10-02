# ADR 004 — Stack: React/Vite + Fastify/Prisma, Vitest, Playwright

## Status
Accepted

## Context
We need one coherent JS/TS stack for a household media app, with fast dev loops.

## Decision
- **Frontend:** React + Vite + TypeScript + Tailwind (already present).
- **Backend:** Node.js + Fastify + Prisma (already present) — light, typed routes.
- **Unit/integration tests:** Vitest (matches Vite, native TS) — server route
  tests use Fastify `inject` with temp SQLite DBs; client tests use Testing Library.
- **E2E + security:** Playwright against the docker-compose stack.
- **Media:** music-metadata + FFmpeg/fluent-ffmpeg.
- **AI:** LM Studio via an adapter, optional.

## Alternatives considered
- **NestJS** — heavier DI framework than we need.
- **Jest** — Vitest integrates more smoothly with Vite.
- **Cypress** — Playwright has better multi-context and headless docker runs.

## Consequences
- One test runner for both tiers; Playwright for browser-level truth.
- All feature specs must express acceptance in testable terms.
