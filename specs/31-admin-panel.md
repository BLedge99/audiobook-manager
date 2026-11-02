# Spec 31 — Admin panel

## Purpose

The operator controls live in the family client today: the folder/scan section
at the bottom of the Library tab, gated on `role === "admin"`. That is the wrong
home for three reasons:

1. **The tier is wrong.** A member opening the Library tab must never discover
   operator plumbing, even as an absent drawer — and the operator voice
   (`copy.operator`) already acknowledges these are different audiences with
   different vocabulary (`copy.ts` line 16):
   the family client is the *listener*; this panel is the *operator*.
2. **It is not enough.** Scanning and adding folders is all that exists. The
   recurring needs — look inside the database, see what the API serves, work
   out *why the phone cannot connect* (ADR 021: the 2026-10-21 and 2026-11-02
   incidents) — have no surface at all.
3. **The credential is wrong.** The panel today only needs sign-in as an admin
   *profile*, meaning the same password that unlocks the household unlocks the
   DB and server state.

This spec is **planned, not started**. It is written before the code, per
`AGENTS.md`. ADR 022 records the architecture decision this spec follows.

## The decision

One server process, **two doors**. The admin panel is a separate Fastify
listener inside the server container, on its own port, with its own credential,
its own session and its own client build:

- **Same process, second port** — a second Fastify instance in the server
  container listening on `ADMIN_PORT` (default `3100`). The main port (`:3000`,
  what every phone points at) serves **no admin route at all** — not a
  `/admin/*` path that merely requires a stronger session; the route table of
  the main server simply does not contain admin surface.
- **Same Prisma, same DB** — the panel runs in the same Node process, sharing
  the main server's Prisma client. This is deliberate (ADR 022): local
  development is SQLite, and a second *connection* (let alone a second
  container) contending on one SQLite file is precisely the corruption risk
  this project's stack cannot absorb today.
- **Reuses the server's own code** — scans, enrichment launches and status
  call the same modules the main server calls, so the panel can never drift
  from what a *scan from the phone's tab* would have done.

**Isolation model.** The isolation is at the network door and the session, not
the file system: Docker compose exposes `ADMIN_PORT` only on demand (see
Compose/config section); nothing changes about where the data lives, so there
is no second thing to keep in sync.

## The credential

A **dedicated admin password**, independent of every profile password:

- `ADMIN_PANEL_PASSWORD` **seeds** it at boot: if the env var is set, its
  bcrypt hash is upserted into an `AdminCredential` row. The plain text lives
  only in the private `.env`, never in the DB, never in an API response,
  never in any log.
- Logins are **rate-limited** (at least 10 attempts / 5 min / IP) and failures
  are logged without echoing back which (password vs user) was wrong, because
  there is only one factor.
- Sessions are **separate from profile sessions**: an `AdminSession` table and
  its own cookie name. Holding a family-client session confers zero admin
  capability, and holding an admin session confers zero listener access; the
  two can be signed out of independently.
- Change-password lives in the panel itself. Changing it invalidates every
  admin session (including the one that changed it) — the operator re-signs
  in, which proves the new password before the browser forgets the old one.
- House rule: **no shared reuse with `APP_PASSWORD`** (spec 28's break-glass).
  Two doors that share a key are one door.

## Behaviour

### The four surfaces

**1. Status dashboard** (default page).

- **Which reality is this server in: local, tunnel, prod.** Derived from
  environment, not guesswork: the deployed instance is
  `audiobook-manager.onrender.com` (ADR 021); tunnel is *absent by design*
  (ADR 006) and the panel says so as the posture, not as a gap: "Local network
  only — remote access deliberately not built (ADR 006)."
- **Server facts:** version, uptime, DB type (SQLite file/PostgreSQL), node
  version, the health endpoint's own answer.
- **Network config report:** the deployed LAN origin policy (plain HTTP by
  decision, ADR 021), configured CORS origins, `WEBAUTHN_RP_ID`/origin pair,
  whether a `MEDIA_TOKEN_SECRET` of real length is configured, and the
  effective library roots.
- **Library roots health:** per root — path, label, last scan status/message,
  file count, and whether the path is accessible from the container. A root
  "gone missing" is the panel's first-class finding, because it is what makes a
  new book fail to appear.
- **Last scans:** the most recent scan runs (start, duration, files found,
  items created/updated), and the enrichment queue's current state.
- **Data freshness:** the newest profile library entry and the newest scan, so
  "is the DB actually being written?" is answerable at a glance.

**2. Library controls.**

- Add a root (path + label), remove a root (with the existing confirmation
  ritual), scan one root, scan every root. The same API semantics the family
  client uses today; no new scan semantics is invented.
- Live scan state while a scan runs (status, files found, message) without
  polling anything the listener tier would care about.
- **The family client's operator section is removed in the same change** once
  parity is reached: after this panel ships, the folder/scan UI comes out of
  the Library tab. Two places for one control is how drift starts.

**3. Database explorer — read-only.**

- A table list with row counts; click a table, page through its rows, see its
  columns and key relations.
- A **read-only SQL console** for the exploratory questions the table list
  cannot answer (`SELECT`, `EXPLAIN`/`EXPLAIN QUERY PLAN`, read-only
  `PRAGMA`). The server enforces it in two layers, so a mis-parsed statement
  still cannot write: a statement allowlist **and** the query itself executing
  inside a DB-level read-only transaction (`BEGIN READ ONLY` /
  `SET TRANSACTION READ ONLY`).
- Results are tables, not JSON dumps; the raw JSON is one toggle away for when
  a value needs copying.
- **No writes in this spec.** Row edits, `upsert`s and schema changes from the
  panel are out. The reason is data integrity, not capability: the DB holds
  derived state (contributor rows, track rows, membership rows) that the
  scanner regenerates and the client trusts — hand edits bypass exactly the
  invariants the app assumes.
- Every mutation an operator *would* write by hand — flipping
  `followsServerLibrary`, fixing a title — is instead a first-class panel
  action that calls the same application function the app itself uses, so the
  derived state stays consistent.
- Everything an operator *would* write by hand (flip `followsServerLibrary`,
  fix a title) is a first-class panel action built on the same app functions
  the app itself uses, rather than a raw UPDATE.

**4. API documentation.**

- Generated from the *live* Fastify route schemas at the moment the page is
  viewed — never a hand-maintained file that drifts, because the one invariant
  this project already holds ("all route inputs validated with Fastify
  schemas") makes the schema the truth.
- Per route: method, path, auth requirement (none / profile session / admin
  session), request schema, response shape and error codes (ADR 015's codes
  rendered with their copy).
- Served as JSON and as a rendered page, so a curl-driven operator and a
  browser operator both work.

### Compose / configuration

- `docker-compose.yml` maps `ADMIN_PORT` to the host only when an env knob
  says so (`ADMIN_BIND=host`, or the port mapping simply commented out by
  default); the panel is unreachable from the LAN by default, reachable for
  the session an operator wants it, with no code change.
- `ADMIN_PANEL_PASSWORD` joins `APP_PASSWORD` in the documented private
  `.env` set.
- The panel's client build is a separate Vite entry (`client/admin/`), built
  by the server container and served at the admin port's root. **No PWA, no
  offline machinery, no service worker, no passkeys** — the panel sits behind
  the operator's password on the LAN, and pretending it needs mobile
  resilience is scope the listener features already cover.

### Copy and look

- The panel does **not** inherit the family shell (capsule world, MachineHead,
  the listener voice). It is a plain, dense, operator-grade UI in a neutral
  style.
- It reuses `copy.operator`'s vocabulary discipline instead of making up
  synonyms: **folder** (not "directory", not "root"), **scan**, **enrichment**,
  as the copy table's term table prescribes.

## Security notes

- Every admin route is behind the admin session. There is **no** pre-auth
  admin endpoint except the login and its rate limiter, and a static
  `GET /api/health` mirroring the main port's.
- All route inputs validated with Fastify schemas (house rule, unchanged).
- The DB console takes SQL from the operator by definition; the protections
  are the allowlist + the read-only transaction + the `ADMIN_PANEL_PASSWORD`
  itself. It must never appear in CORS as a main-app origin, and must never
  be proxied by the family client's Vite dev server.
- No absolute server paths leak except library roots, which are config the
  operator set and the panel is the place to see them.
- `npm audit` before finishing dependency changes (house rule, unchanged).

## Acceptance criteria

- [ ] The main port returns 404 for every panel route and serves no admin
      session cookie.
- [ ] With `ADMIN_PANEL_PASSWORD` unset, the panel boots into a locked state
      saying exactly that, and nothing but `GET /api/health` answers.
- [ ] Login accepts the seeded password, is rate-limited, and every panel page
      redirects to it when the session is absent or expired.
- [ ] Changing the password from the panel invalidates every admin session,
      including the changing one.
- [ ] Status dashboard shows: mode (local/prod/tunnel-absent), DB type, node
      version, CORS origins, WebAuthn pair, media-token state, root health,
      last scans, enrichment queue state, data freshness.
- [ ] Library controls: add root, remove root with confirmation, scan one
      root, scan all; live scan state visible without hard refresh.
- [ ] After parity, the family client's folder/scan section is gone, and a
      member-visibility test proves it.
- [ ] DB explorer lists tables with counts, pages rows, and answers a
      read-only query. A cleared write attempt (`UPDATE …`, `INSERT …`,
      `DELETE …`, `CREATE …`) is refused by both the allowlist and the
      read-only transaction — a test exercises both layers in isolation.
- [ ] API docs page renders every route of the main port and marks admin
      surface distinctly, from live schema data.
- [ ] Compose: with default env, the admin port is **not** host-mapped and an
      E2E asserts that; with the panel bound, its E2E suite runs against it.
- [ ] Server unit/integration tests via `inject` cover each surface; the panel
      mini-app has its own Vitest suite for pure logic (no listener-tier
      physics is imported here); Playwright covers login → dashboard → scan →
      read-only query.
- [ ] `npm audit` clean at feature end.

## Phasing

Four independently shippable phases, in this order:

1. **Admin surface + auth.** Second listener, credential, session, lock
   screen, health. Shipped alone this is already a feature: the admin API
   exists and the port is honest about it.
2. **Status dashboard.** Read-only reporting; no state change at all.
3. **Library controls.** Root add/remove + scan, calling existing modules;
   family client's operator section retired the same day.
4. **DB explorer + API docs.** Both read-only; both schema/truth-derived.

Each phase lands with its tests against the criteria above.

## Not in this spec

- **Writing to the DB from the panel** (later spec, if the household earns it).
- **Two-factor auth for the panel.** The credential is one factor on a LAN
  tool; revisit only if the panel is ever exposed beyond the LAN (ADR 006's
  own revisit condition).
- **Remote access of any kind.** Unchanged by this feature; ADR 006 stands.
- **Serving the panel from the production Render instance.** It is built to
  run where the operator runs it, at the door they configure. Prod deploy of
  the *panel* is not part of this feature.
- **Metadata writing into media files.** Forbidden house rule (spec 13), and
  the panel's API docs for enrichment will not smuggle it in either.
