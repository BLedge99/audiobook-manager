# ADR 022 — The admin panel is a second listener in the server process, not a second container

## Status

Accepted 2026-11-02. Follows ADR 004 (stack), ADR 019 (PostgreSQL production,
SQLite local), ADR 006 (local network only), ADR 021 (LAN exposure posture).
Spec: [`specs/31-admin-panel.md`](../specs/31-admin-panel.md).

## Context

The operator controls (add folder, scan, rescan) live inside the family client
behind `role === "admin"`. Feature request 2026-11-02: a proper admin panel
with library controls, database inspection, API documentation and a status /
network-configuration report — with a separate password, and possibly a
separate port and a separate container for isolation.

Two stack facts constrain the "separate container" idea:

- **Local development and tests are SQLite** (ADR 019, and the compose
  `DATABASE_URL=file:/app/data/library.db`). A second *process* holding its
  own Prisma connection to the same SQLite file is two writers on one file:
  locking churn at best, corruption at worst. WAL softens it, but "softens" is
  not the word a household tool may say about its own database.
- **The admin operations are server-module code.** Scanning is
  `server/src/scanner.ts`; enrichment is the same process's queue. A separate
  panel container would either duplicate the scanner (drift, the exact failure
  AGENTS.md exists to prevent) or call back into the main server — an RPC
  layer whose only reason to exist is isolation that, per the first fact, does
  not actually exist for the data.

## Decision

The admin panel is a **second Fastify listener inside the server container**:

- **Same process, second port.** The main port (`:3000`, what every phone and
  the family client point at) contains *no admin route*. The admin surface is
  a second listener on `ADMIN_PORT` with its own route table, its own session
  store and its own client build. An attacker who finds the family client
  origin has found no admin surface at all — there is nothing to escalate to.
- **Same Prisma client instance.** One database connection pool, one process,
  one scanner. The panel is a different door, not a different house.
- **A dedicated credential.** `ADMIN_PANEL_PASSWORD` seeds a hashed
  `AdminCredential`; the panel's session cookie is a different table and a
  different cookie from the profile sessions. No reuse with `APP_PASSWORD`.
- **Read-only data access in v1.** The DB explorer executes inside a DB-level
  read-only transaction behind a statement allowlist. Writes happen later, if
  at all, as first-class panel actions calling application functions — never
  as raw SQL.

## Alternatives considered

- **Separate container (the caller's first suggestion).** Maximum isolation in
  principle; rejected for now. SQLite contention makes it actively unsafe
  locally, and the scanner/enrichment reuse requirement makes it a fork or an
  RPC hop. It becomes viable when production PostgreSQL is the *default* path
  for this deployment, not just the production instance; re-evaluate then. The
  second-listener design migrates to it unchanged in principle: move the
  listener into a container, keep the door.
- **Same port, `/admin/*` paths.** Rejected. The main port is the door the
  whole household and the Android app use. Even a perfectly-gated admin path
  means the same origin carries both surfaces, cookies share a jar, and a
  future route mistake on `:3000` would be an admin-route mistake. Two ports
  make that class of error structurally impossible.
- **Reverse proxy (Caddy) carve-out.** Rejected. It hides the separation from
  the code — route tables would look unified while the plumbing promised
  otherwise, and the deployment gains a component whose whole job is second
  guessing the pattern-matching.

## Consequences

- Compose exposes `ADMIN_PORT` only when configured, so the panel is LAN-unreachable
  by default; the operator opts in per session, and an E2E asserts the default.
- The server process now holds two ready listeners; the health endpoint stays
  on the main port, and the panel's own surface answers health only behind its
  own credential.
- Tests: admin routes are integration-tested with `inject` on the admin
  listener; the panel UI is its own small client with its own unit suite; a
  Playwright flow covers the whole door.
- If remote access is ever revisited (ADR 006's own revisit condition), the
  admin listener is *not* what gets exposed; the panel rides the second port
  because of what it guards.
