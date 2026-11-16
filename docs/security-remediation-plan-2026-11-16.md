# Security Remediation Plan — 2026-11-16

**Status 2026-11-16: Phases 0–3 implemented and pushed to `master`** (commits
b28bdbf → 1ab9b63+docs). Items are labelled with what shipped vs. what is
accepted-risk/deployment-only (Phase 4, below). All server and client suites
pass; see the final report for the per-phase detail.

From the security audit of 2026-11-16 (see chat report / `SECURITY.md`). Findings are
implemented on `master` in phases, TDD (failing test → fix → green), one logical commit
per finding or finding group, pushed at the end of each phase.

Source order: AGENTS.md → specs/ (esp. `11-security-hardening.md`) → this plan.

## Phase 0 — Plan
- [x] This document.

## Phase 1 — HIGH (all code-fixable now)
1. **SSRF in cover download** (`server/src/metadata/cover.ts`)
   - Per-redirect-hop validation (manual redirect following, max 5 hops).
   - Host normalization: strip IPv6 brackets, expand IPv4-mapped IPv6, reject
     loopback/private/link-local/ULA/unspecified, recognise WHATWG-normalised
     IPv4 (`2130706433`, `0x7f000001`, `017700000001`, `127.1` all parse to
     `127.0.0.1` in `new URL`), trailing-dot `localhost.`.
   - DNS check: reject hosts whose A/AAAA answers are non-global (lookup injected
     for tests, best-effort at runtime).
   - Stream body with byte counter; abort at `maxBytes + 1` (no full buffering).
   - Require content-type ∈ {jpeg, png, webp}; verify magic bytes
     (FFD8 / 89504E47 / RIFF…WEBP); keep the `<html` sniff as defence in depth.
   - Tests: `server/src/metadata/cover.test.ts` (new/extended).
2. **Admin panel cookie never Secure** — pass `secureCookie: process.env.COOKIE_SECURE === "true"`
   from `index.ts` into `buildAdminApp`. Test: admin login sets `Secure` when configured.
3. **Admin listener binds 0.0.0.0** — default `127.0.0.1`, opt out via `ADMIN_HOST`;
   household `docker-compose.yml` maps `127.0.0.1:3100:3100`. (Doc + compose change;
   no unit test — verified by config review.)
4. **Family session cookie** `SameSite=None` → always `Lax` (`auth/routes.ts`). Test: with
   `COOKIE_SECURE=true` the cookie is `SameSite=Lax`.
5. **Security headers everywhere** — `@fastify/helmet` on family + admin listeners:
   CSP `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
   img-src 'self' data: blob: https:; media-src 'self' blob: https:; connect-src 'self';
   frame-ancestors 'none'`; `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.
   Client inline theme script moves to `client/public/theme-init.js`.
   Tests: inject `/` and assert headers on both listeners. Render deployment gets
   these from the app automatically (no edge rules needed).

## Phase 2 — MEDIUM
6. **`POST /api/enrichment/run` gate** — child → 403; non-admin `force:true` without
   `mediaItemId` → 403; member single-item requires `canReadMediaItem`. Test in
   `routes/enrichment.test.ts`.
7. **GDPR export completeness (Art. 15/20)** — add `email`, `lastActiveAt`,
   `lastLoginAt`, `disabled` to profile `select`. Update `gdpr/personal-data.test.ts`.
   Note in `docs/roa.md` / `docs/retention.md` (GDPR features change).
8. **Read-only SQL console hardening** — blocklist gains `pg_terminate_backend`,
   `pg_cancel_backend`, `pg_reload_conf`, `pg_rotate_logfile`, `pg_stat_file`,
   `pg_advisory_lock`, `lo_import`, `pg_read_binary_file`, `pg_ls_*`,
   `set_config` (already), `dblink`. Drop `database_list` from the PRAGMA allowlist.
   SQLite sync-driver compute limit: documented as operator-only risk in
   `read-only-sql.ts` + LIMITATIONS (worker isolation is a separate change).
   Tests in `read-only-sql.test.ts`.
9. **Child → member role mapping** — propagate `"child"` at the four mapping sites
   (`auth/internal.ts`, `auth/sessions.ts`, `auth/service.ts` listAccounts,
   `auth/routes.ts` login payload). Tests per site.
10. **Admin cookie scoping** — cannot path-scope to `/admin` (`/api/admin/*` shares the
    port). Mitigation instead: `SameSite=Strict` confirmed, keep `path=/`, document
    residual risk + Caddy IP allowlist snippet in `docs/production-https.md`.
    (No code change; decision recorded here.)
11. **GDPR / profile input validation** — `POST /api/profiles`: required name,
    maxLength 80, `additionalProperties:false`; play-session `startedAt/endedAt`
    validated as dates → 400 on garbage; `PATCH /api/me` P2002 → 409; `GET
    /api/discover/similar/:id` dead `limit` param removed from schema. Tests.
12. **Dual erasure paths** — `routes/profiles.ts` self-delete and `admin/child-accounts.ts`
    call `eraseProfilePersonalData`; unparseable id → 400 not 500. Tests.
13. **Embedded-cover extension** — whitelist `jpg|jpeg|png|webp` derived from validated
    magic bytes, not `file.cover.format`; cover responses carry `nosniff`.
    Extract `coverExtension(buffer)` helper + unit tests.
14. **Stream robustness** — `createReadStream` errors after stat attach an `error`
    handler that destroys the reply instead of an unhandled stream error; same for
    deferred cover stream. Test where feasible.
15. **Client: href scheme validation** — `buyLinks`/`GetThisBookSheet` accept only
    `https:` (upgrade `http:`); drop other schemes. Client test.
16. **Client: `normaliseServerUrl`** — restrict to `^https?://`. Client test.
17. **Client: third-party cover privacy** — `referrerpolicy="no-referrer"` on cover
    `<img>`s (`CoverImage.tsx`).
18. **Client: strip console in prod build** — `esbuild.pure: ['console.log','console.debug','console.info']`
    + drop `debugger` in `vite.config.ts` and `vite.admin.config.ts`. Verify build.
19. **`/api/enrichment/status`** — child → 403 (mirrors review-queue gating). Test.
20. **`/api/enrichment/run` rate limit** — fold into #6's gate (member-triggered runs
    only, still cheap to abuse); no separate limiter added — noted in LIMITATIONS.
21. **Password reset / change** — `changePassword` also revokes other-profile sessions
    (already); household break-glass session TTL + APP_PASSWORD-rotation revocation:
    documented as accepted design in `docs/` + LIMITATIONS (no behaviour change).
22. **Supabase sync buffers before 50 MB check** — stream response with byte counter,
    abort past cap. Test with mocked `fetch` if the harness allows; else manual review.

## Phase 3 — LOW / hygiene
23. **Email timing oracle** (`signInWithEmail`) — verify against precomputed dummy hash
    when email unknown. Test: unknown email performs the same hash work / same error.
24. **`TRUST_PROXY` handling** — numeric values → hop count (`trustProxy: n`) instead of
    unconditional `true`; `true` keeps legacy behaviour with a startup warning;
    documented in `.env.production.example`. Light test of the parsing helper.
25. **OAuth error code reflection** — whitelist known `auth_error` codes for the
    `/?auth_error=` redirect. Test.
26. **OAuth redirect URI fallback** — in production, require `*_REDIRECT_URI` env for
    every enabled provider (fail fast at boot). Test of config validation.
27. **`PRODUCTION_URL`… media tokens in URLs on native** — no code change; document
    in LIMITATIONS (5-min TTL, scoped, redacted in logs).
28. **Wishlist seed id** — require `visibleForAge` for the seed item. Test.
29. **`PRAGMA database_list`** — removed from allowlist (see #8).
30. **Absolute paths in admin-gated APIs** — `/api/scan/status`, `/api/library-roots`:
    return label/id only, drop `root.path` (verify client doesn't render it first);
    scan error messages stored sanitized. Tests updated.
31. **Role mapping consistency** — child→child everywhere (see #9).
32. **`/api/auth/accounts`** — drop `role`/`has*` fields if the client picker does not
    render them (verify client first); keep list in household mode.
33. **Family sessions hard-cap note** — LIMITATIONS entry (30-day sliding TTL accepted).
34. **`x-profile-id` + discover.ts** — consistency note only; no change (not exploitable).

## Phase 4 — Documentation / deployment (no code, or config-only)
35. LIMITATIONS.md entries: SQLite sync-driver compute limit; break-glass 30-day TTL;
    media-token URLs on native; Capacitor cleartext + mixed content (blocked on an
    HTTPS-served Android build — steps documented, `cleartext` NOT flipped blindly as it
    would break the LAN HTTP deployment); `/api/auth/accounts` metadata note;
    enrichment/run member-triggered quota note.
36. `docs/production-https.md` — add Caddy snippet: `handle /admin/*` → IP allowlist or
    VPN; headers now app-level (HSTS note for Caddy-only edges).
37. `.env.production.example` — TRUST_PROXY guidance (`1` or specific proxy IP, never
    blanket `true`), ADMIN_HOST note, secureCookie note.
38. `docs/roa.md` + `docs/retention.md` — GDPR export now includes email/lastActiveAt/
    lastLoginAt/disabled (lawful basis Art. 6(1)(b)/(c), erasure unchanged).
39. `GDPR-REMEDIATION`/spec 11 cross-check; this plan archived as completed checklist.

## Verification
- `npm --prefix server test` and `npm --prefix client test` green after each phase.
- `npm run typecheck` both packages; `npm --prefix client run build` (config change check).
- `npm audit` before finishing dependency changes (adds `@fastify/helmet` only).
- Production Render deploy: headers verified post-deploy (app-level, no Render config).
- Commits: one per finding group, `fix(security): …`, pushed to `master` per phase.
