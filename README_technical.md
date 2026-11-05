# Audiobook Manager — Technical README

A local-first household audiobook server: scans local storage for audiobook files, enriches metadata, and serves a Netflix-style browsing and playback experience to desktop and Android clients over the home network.

## Project overview

Audiobook Manager is a household media server with two tiers:

- **Server (Node.js + Fastify):** owns the library, the database, the scanner, the enrichment pipeline, auth, and the streaming API. It is stateless-ish; the database is authoritative.
- **Client (React + Vite + TypeScript):** a single-page application served by the dev server in local development and by the production build behind Caddy. It also ships as a Capacitor-wrapped Android WebView app.

The product targets a non-technical household: one shared password gates entry, named per-user profiles hold isolated progress and history, and the app must work fully without AI. Media files are treated as read-only; nothing is ever written into user media.

## App architecture

### High-level data flow

```
[Audio files on disk] --> [Scanner (music-metadata + FFmpeg)]
                                      |
                                      v
                              [Database: books, tracks, chapters, covers]
                                      |
                                      v
                              [Enrichment chain: Open Library, Google Books, LibriVox, Audnexus]
                                      |
                                      v
                              [Fastify REST API]
                                      |
                                      v
                              [React client / Android WebView client]
```

### Server responsibilities

- **Scanner:** walks configured `LibraryRoot` folders, parses embedded tags, chapters, durations, and cover art using `music-metadata` and `fluent-ffmpeg`/FFmpeg. Groups files into logical audiobooks (multi-file sets and single-file M4Bs). Always creates one `Track` row per file so single-file books are downloadable.
- **Enrichment:** provider chain matches books to Open Library, Google Books, LibriVox, and Audnexus. Matches are applied with a manual confirm step; user corrections win. Auto-apply uses a score floor with an author-agreement guard in the 0.7–0.9 band.
- **Library API:** serves books, tracks, chapters, cover art, search, genre/series shelves, and per-profile membership.
- **Playback API:** media-token-protected streaming (`/api/audiobooks/:id/stream`), bounded range requests with 416 on invalid ranges.
- **Progress & history:** per-profile per-book listening position, completed state, sessions, speed, timestamps. Monotonic progress (forward pushes apply silently; backward moves beyond 5 minutes are blocked and surfaced as conflicts).
- **Auth:** single shared household password (session cookie). Spec 28 adds per-profile accounts, passkeys (web), and biometrics (Android Vault) — implementation present, production Caddy/CA and real biometric flows unverified.
- **Admin panel:** second Fastify listener on `ADMIN_PORT` (3100), separate `ADMIN_PANEL_PASSWORD` credential/session, operator mini-app, read-only status dashboard, library controls, read-only DB explorer with allowlisted tables and query policy, API docs generated from live Fastify route schemas.
- **Security:** all route inputs validated with Fastify schemas; filesystem reads confined to configured `LibraryRoot`s via `safePath`; rejects `..`, `%2e%2e`, absolute client paths, and symlinks escaping the library root; CORS restricted to known origins; absolute server paths never leaked in responses or errors.

### Client responsibilities

- **Library & browse:** grid, search, detail view, genre shelves, filter bar with URL state, series shelves, Discover tab, tag manager, enrichment review queue.
- **Playback:** chapter seek, playback speed, sleep timer, resume. Player state is the listening position (not the loaded media source), per ADR 017 — advance is driven by the clock, not by media `ended` events.
- **Offline:** Dexie/IndexedDB replica of catalogue metadata and covers; `@capacitor/file-transfer` downloads tracks to app-private filesystem; `convertFileSrc` for local playback; foreground service via `@capgo/capacitor-media-session` for screen-off playback and lock-screen controls.
- **Auth gate:** static assets and the SPA fallback load before a session exists; `x-house-session` header and query-string token for media/image elements that cannot send headers.
- **Reachability:** bounded probe (10s) and `boundedFetch` (30s default); every request should pass through `boundedFetch`; failed requests re-probe and surface human-readable messages with next steps.

### Directory layout

```
client/            React + Vite + TypeScript frontend (admin app, android shell)
server/            Node.js + Fastify backend
server/prisma/     Prisma schema + migrations (PostgreSQL prod, SQLite local/test)
test/              Real LibriVox MP3 sample libraries for scanner tests/fixtures
e2e/               Playwright E2E + security suite
decisions/         ADRs (architectural decision records)
specs/             One spec per roadmap feature: behaviour + acceptance criteria + checks
docs/              Operational guides (production HTTPS, book storage)
scripts/           Copy check, LAN exposure, device tunnel, E2E WSL provisioning
```

## Tech stack

| Layer | Technology | Role |
|-------|-----------|------|
| Frontend | React + Vite + TypeScript + Tailwind CSS + shadcn/ui | SPA client, admin mini-app |
| Backend | Node.js + Fastify + Prisma ORM | HTTP API, scanner, enrichment, auth |
| Database (local/test) | SQLite via Prisma | Development and test database |
| Database (production) | PostgreSQL (managed, e.g. Supabase) | Production database |
| Media processing | FFmpeg / ffprobe, fluent-ffmpeg, music-metadata | Tag, chapter, duration, cover extraction |
| AI (optional) | LM Studio via OpenAI-compatible adapter | Metadata matching, summaries; never gates core |
| Mobile | Capacitor + `@capgo/capacitor-media-session` | Android WebView wrapper, screen-off playback |
| Reverse proxy (prod) | Caddy | HTTPS termination at `books.home.arpa` |
| Container orchestration | Docker Compose | Local dev stack and production deployment |
| Testing | Vitest (server + client), Playwright (E2E + security) | Unit, integration, E2E, security |
| Static assets | Self-hosted fonts | No external font dependencies |

### Test coverage

- Server: Vitest with Fastify `inject` against temp SQLite databases; route integration tests.
- Client: Vitest + Testing Library.
- E2E + security: Playwright against the docker-compose stack, including path traversal, bad input, and range abuse tests.
- Copy check: `make check-copy` gates UI copy against banned-word rules (spec 15b feature 7).

## Reasons for key decisions

**SQLite locally, PostgreSQL in production (ADR 019).** One Prisma model serves both; the SQLite schema is generated from the canonical PostgreSQL schema via a sync script so the two cannot describe different models. Local dev and tests stay SQLite to avoid requiring Docker or a database for every `npm test`; production uses a managed PostgreSQL.

**Local network only (ADR 006).** No tunnel, no port forwarding, no public exposure. The household is non-technical, and public hosting adds auth/TLS burden before the auth model is mature. Remote access is deliberately deferred.

**Device is a player, not a library manager (ADR 012).** The server holds authority; the device holds a read replica. Scanning, enrichment, and library management happen server-side only. The device downloads and plays.

**Read-only media mount.** AI is optional; nothing is ever embedded into user media files. Metadata enrichment results live in the app database. Media tagging/embedding is a separate, explicit, user-confirmed future feature (spec 13), currently out of scope.

**Fastify over NestJS.** Lighter DI surface, typed routes, faster dev loops for a small team.

**Vitest over Jest.** Native TypeScript, integrates smoothly with Vite; one test runner for both tiers.

**Playwright over Cypress.** Better multi-context support and headless Docker runs; the security suite runs in CI-style fashion.

**AI optional (LM Studio adapter).** AI augments matching and summarisation but never gates core behaviour; the app works fully offline with AI off.

**Player state is position, not media source (ADR 017).** A seek into another file cannot rewind the readout, and advance never depends on an `ended` event. This fixed a class of playback bugs where chapter-advance code was unreachable.

**Admin panel on a second listener (ADR 022).** The operator tier lives in exactly one place (port 3100) and does not touch household-facing routes; the family Library tab loses the folder/scan section once the panel has parity.

**Offline cache provable two ways (ADR 018).** A cache counts as present when either the password envelope or the native Vault holds the key; offline unlock always offers "change server address" and "listen without progress."

## Limitations

This is an honest list of what does not work yet, why, and what is planned. Full detail is in `LIMITATIONS.md`.

- **Google Books** is non-functional without an API key; the mapping code is written and tested but the credential is missing. This is the biggest single coverage gap for publisher, ISBN, and categories.
- **Audnexus** is architecturally blocked: it has no book-search endpoint and is ASIN-keyed, but the fixture library carries no ASINs. Only chapter-title lookup (`chaptersByAsin`) is live.
- **Listening progress** is last-write-wins and can silently regress (a stale device can overwrite a fresher bookmark). Monotonic progress is specified but not yet fully shipped.
- **Android WebView** reaches the home server over plain HTTP on the LAN; credentials and sessions on that path lack transport encryption. Do not use on untrusted networks or expose to the internet. Production web has Caddy TLS at `books.home.arpa` but it is not yet deployed with Windows CA trust/Hello.
- **Discover** suggests print books from Open Library, not audiobooks; cards are labelled "BOOK — NOT AN AUDIOBOOK YET." There is no free key-less audiobook-to-audiobook similarity service.
- **Narrator coverage** is capped at 8/12 by what files carry locally (`composer` atom → `Read By X` comment → bracketed folder name). No online narrator fallback exists.
- **Series coverage** is 6/12 and may be at its ceiling; several commercial sets have no series data upstream.
- **Cover art** comes from book catalogue editions, not the specific audiobook you own; you may get a different edition's jacket. Covers are now cached (server `Cache-Control` + `ETag`, device IndexedDB cache), which makes a wrong cover sticky until the `ETag` changes.
- **Auto-apply** has a deliberate author-agreement judgement call in the 0.7–0.9 score band.
- **Contributor sets** are replaced wholesale on enrichment; last write wins.
- **Media.items.asin** exists in the schema but is never written.
- **No remote access** (by design). No public hosting, no Tailscale, no Cloudflare Tunnel yet.
- **No transcoding, no M4B merging, no metadata embedding into files.**
- **No social features, sharing outside the household, or ratings from strangers.**
- **No multi-server sync or cloud backup.**
- **No native iOS app**; iOS is explicitly not a requirement. iPhones/iPads can use the website in a browser.
- **Offline editing/enrichment/scanning** are deliberately server-only.
- **Download queues / whole-library sync** are out of scope; one book at a time over the LAN.
- **Play Store publishing** is not planned; sideloaded APK is acceptable for a household.
- **Chapter/track title editor UI** is missing; the endpoint and storage exist but are only reachable via API.
- **Bookmarks & highlights** need a new data model and are out of scope.
- **Search relevance ranking** keeps library order; no fuzzy matching or stemming yet.
- **Server-side search** is not implemented; the library is fetched whole and filtered client-side.
- **PWA raster icons / Lighthouse** are placeholder SVG only; no Lighthouse PWA audit has been run.

## API overview

The server exposes a REST API over HTTP. All route inputs are validated with Fastify schemas; there is no raw `request.body` use.

**Authentication**
- `POST /api/auth/login` — household password login; sets session cookie.
- Sessions gate all mutating and most read routes.

**Library**
- `GET /api/audiobooks` — list books (with per-profile progress when authenticated); supports `304` via `If-None-Match`.
- `GET /api/audiobooks/:id` — book detail.
- `GET /api/library-roots` — configured library folders.

**Playback**
- `GET /api/audiobooks/:id/stream` — media-token-protected audio stream; bounded range requests, 416 on invalid ranges.

**Progress**
- `PUT /api/audiobooks/:id/progress` — update listening position (monotonic rules apply).

**Enrichment**
- `POST /api/enrichment/run` — run a forced enrichment pass over the library.
- `GET /api/enrichment/status` — enrichment run status.

**Scan**
- `POST /api/scan` — trigger a library scan; waits for completion via status polling.
- `GET /api/scan/status` — scan status.

**Admin (second listener, port 3100)**
- Admin panel routes, read-only status dashboard, library controls, DB explorer (allowlisted tables), generated API docs from live Fastify route schemas.

**Security**
- `GET /api/health` — health check.
- All filesystem access confined to `LibraryRoot` paths; traversal and absolute-path rejection.

## Production vs local deployment

| Aspect | Local development | Production |
|--------|------------------|------------|
| Database | SQLite (`file:/app/data/library.db`) | PostgreSQL (managed, e.g. Supabase) via `DATABASE_URL` |
| Reverse proxy | None (client :5173, server :3000 directly) | Caddy terminates HTTPS at `books.home.arpa`; proxies to app |
| Server port | `3000` (plus admin `3100` opt-in) | `3000` remains available to Android wrapper; web uses `443` via Caddy |
| Client | Vite dev server on `5173` | Production build served by Caddy |
| Auth | Single shared household password (`APP_PASSWORD`, defaults `household`) | Required `APP_PASSWORD`; optional OAuth (Google/GitHub) + email/password for demo audience |
| Admin panel | Opt-in via `docker-compose.admin.yml` | Separate `ADMIN_PANEL_PASSWORD`; operator dashboard |
| Cookies | `COOKIE_SECURE` not set | `COOKIE_SECURE: "true"`; `TRUST_PROXY` set to Caddy internal IP |
| WebAuthn | `localhost` RP id / origin | `books.home.arpa` RP id / `https://books.home.arpa` origin |
| Media files | Mounted read-only (`./test:/media:ro` or local library roots) | `${MEDIA_PATH}` mounted read-only; durable audio in private Supabase Storage bucket (operator uploads) |
| Cache | Local SQLite file + named Docker volumes | `app_data` volume; covers in `COVER_DIR` |
| Deployment | `docker compose up -d` | `docker compose -f docker-compose.prod.yml up -d --build` |
| Migrations | `prisma migrate deploy --schema prisma/sqlite/schema.prisma` | `prisma migrate deploy --schema prisma/schema.prisma` |
| Secrets | `.env` with defaults | Required: `DATABASE_URL`, `APP_PASSWORD`, `MEDIA_TOKEN_SECRET`; optional OAuth credentials |
| Network | Home LAN; `make lan` exposes server to phones via port proxy | `books.home.arpa` HTTPS; Android HTTP LAN address remains available |

### Key production differences to remember

- **Database provider is baked into the generated Prisma client.** Local and production cannot share a generated client or migration history; always name the schema explicitly (`--schema prisma/schema.prisma` for production, `--schema prisma/sqlite/schema.prisma` for local/test).
- **Production requires secrets.** `DATABASE_URL`, `APP_PASSWORD`, and `MEDIA_TOKEN_SECRET` must be set before deploy; the compose file fails fast if they are missing.
- **Caddy is the public entry point.** Browsers should reach `https://books.home.arpa`; port `3000` is kept for the Android wrapper (ADR 014) and is not the web entry point.
- **Android still uses plain HTTP on the LAN.** Its configurable local server path does not yet provision a trusted TLS CA; credentials and sessions on that path lack transport encryption.
- **The production image prunes development dependencies and runs as the unprivileged `node` user.**

## Getting started (developers)

```bash
# Start the full local stack (server :3000, client :5173)
make start

# Recreate containers after changing server code
make restart

# Trigger a library scan and wait for completion
make scan

# Run backend + frontend unit suites
make test

# Run full E2E + security suite (stack must be up)
make test-e2e

# Expose the server on the LAN for phones
make lan

# One-command bring-up with LAN exposure
make local

# Tear down and rebuild from scratch
make reset
```

Tests use a temp SQLite database; no Docker or external database is required for `make test`. E2E requires Docker and (on Windows/WSL) `scripts/e2e-wsl.sh`.

## Security notes

- `npm audit` reports zero known vulnerabilities across root, server, and client dependency trees (as of the last security refresh).
- Do not leak absolute server paths in API responses or errors.
- Range requests are bounded and validated; invalid ranges return 416.
- CORS is restricted to known client origins.
- The Android LAN path is plaintext; do not expose it to the internet or use on untrusted networks.

## Contributing

Changes should follow the source-of-truth order: `roadmap.md` → `specs/NN-<feature>.md` → `decisions/` → `LIMITATIONS.md` → code. If code and spec disagree, fix the code or update the spec in the same change. Migrations stay additive; a model change needs a migration in both PostgreSQL and SQLite histories.
