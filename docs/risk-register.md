# Accepted-risk register

Risks that are knowingly accepted rather than fixed. Each entry names the owner,
the rationale, the compensating control, and a review date. Reviewed annually;
next review due **2027-05-16**.

Owner: besben (household operator / maintainer)

| # | Risk | Compensating control | Rationale | Review |
|---|------|----------------------|-----------|--------|
| R1 | No monitoring or alerting; host failure (Pi down, disk full, cert expired) is discovered manually | Structured logs with token/cookie redaction; Docker `restart: unless-stopped`; trivial manual restart | A restarted-by-hand service, not a critical one; blocking on monitoring would delay every other fix for weeks | 2027-05-16 |
| R2 | **Backup is same-site only** - host/NAS loss, ransomware, or volume wipe destroys listening history (profiles, progress, favourites) | Weekly `age`-encrypted `pg_dump`, 7 newest dumps retained (`scripts/backup-db.sh`); annual restore drill into a disposable Postgres (`docs/drills.md`); media itself is re-acquirable and out of backup scope | No second site, no cloud account wanted; encryption keeps Art. 32 intact; host-loss is knowingly accepted | 2027-05-16 |
| R3 | CSRF = `SameSite=Lax` (family) / `Strict` (admin); no double-submit tokens | Documented posture (SECURITY.md); LAN-trusted household clients; JSON-only mutating routes; admin is loopback-only in household deployments | No cross-origin embedding scenario exists in the household threat model; tokens would touch every fetch call site for no realistic benefit | 2027-05-16 |
| R4 | The hosted demo is a public beta with known, accepted risks (not a staffed service) | `ACCOUNT_EXPERIENCE=demo` gating (OAuth auto-provision limited to demo since spec 43 phase 2.2); security headers; Postgres RLS on Supabase (spec 35); read-only admin console denylist (spec 43 phase 2.1) | It exists to let people try the product; "production" in conversation must not imply more than beta — RLS + headers + the denylist are the guard rails | 2027-05-16 |

## Smaller accepted items (carried from the 2026-11-16 remediation plan)

| # | Item | Why it is accepted |
|---|------|--------------------|
| A1 | SQLite sync driver for the admin read-only console has a compute limit (busy timeout, not a wall-clock) | Single-operator console on a household box; a hostile cross-join can starve the process, but there is no untrusted user here. If it ever goes multi-user, run queries in a worker with an interrupt |
| A2 | Household break-glass (`APP_PASSWORD`) session has a long TTL; rotating APP_PASSWORD does not revoke it | Documented break-glass semantics (spec 28): recovery path of last resort, not an everyday credential |
| A3 | Media-token URLs (`?token=`) are visible in logs/proxies that don't strip them | 5-minute TTL, profile-scoped, single-purpose, redacted from Fastify logs; native media elements cannot send headers |
| A4 | `/api/auth/accounts` lists names/colours without auth (household mode) | Deliberate: the profile picker must render before a profile is chosen; names/colours are not secret in a household. Drop the listing or gate it if deployed anywhere beyond the LAN |
| A5 | Enrichment run endpoint has no member-triggered quota | Member-only trigger, single item at a time requires read access; abuse is a minor resource drain on a home server |
| A6 | Capacitor Android wrapper currently uses cleartext HTTP on the LAN | Blocked on an HTTPS-served Android build; flipping `cleartext` blindly would break the LAN HTTP deployment; steps documented in LIMITATIONS §4 |

Adding an entry here requires: the risk written plainly, the compensating
control, the reason it is not fixed now, and a review date. Removing one
requires the fix and its test.
