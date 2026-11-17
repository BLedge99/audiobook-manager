# Security Policy

Bookle (audiobook-manager) is a self-hosted, household-scoped app: a family or
household runs it on their own hardware or a single hosted demo instance. It is
not a multi-tenant service, and it is maintained by one person in their spare
time. This policy says, plainly, what to expect.

## Supported versions

| Version | Supported |
| ------- | --------- |
| `v0.2.x` and later (once tagged) | :white_check_mark: |
| `v0.1.0-pre` and earlier `v0.x` | :x: (pre-release; upgrade instead) |

Only the latest `v0.x` line receives fixes. There is no LTS. Fixes land on
`master` as ordinary commits.

## Reporting a vulnerability

**Do not open a public issue for a vulnerability.**

- **Preferred:** a private security advisory on the repository —
  `https://github.com/BLedge99/audiobook-manager/security/advisories/new`
- Alternatively, email the maintainer directly if you have a contact for them.

Include: what you found, the affected component (family listener `:3000`, admin
listener `:3100`, client, or deployment), a reproduction, and the impact you
believe it has. If you are a household operator of a self-hosted instance,
say so — it changes the exposure assessment.

**What to expect:** an acknowledgement within about a week (best effort; one
maintainer, evenings and weekends). If the report is accepted, a fix is
developed on `master` and released in the next `v0.x` tag; you get credit if you
want it. If it is declined, you get the reason. There is no bug bounty and
no SLA.

**Please do not** test against instances you do not own — the public demo
(`audiobook-manager.onrender.com`) is shared infrastructure operated by the
maintainer, not a test range. Use a local deployment (the repo's
`make start` brings one up) for reproduction wherever possible.

## Scope and threat model

- The **household deployment** is LAN-trusted: every device on the home Wi-Fi is
  inside the trust boundary. Passwords, passkeys and per-profile accounts exist
  for *privacy between family members*, not to exclude the household.
- The **hosted demo** (`ACCOUNT_EXPERIENCE=demo`) is a public instance with
  email/password sign-up (demo-gated open sign-up) and OAuth sign-in when the
  operator sets `OAUTH_ENABLED=true` with registered redirect URIs — the
  committed `render.yaml` ships with `OAUTH_ENABLED=false`, so email/password
  is the guaranteed path. It is run as a public beta and treated as having a
  wider, less trusted audience. The `x-profile-id` isolation, child-account
  gating and demo-vs-household policy are the load-bearing controls there.
- The **admin panel** (`:3100`) is the operator surface. It listens on
  loopback by default; when `ADMIN_PROXY=true` it is reachable through the
  family port under `/admin` — that proxy is for the hosted demo only and is
  off in household deployments.

## Cookie policy and CSRF posture (accepted risk R3)

- Family session cookie: `HttpOnly`, `SameSite=Lax`, `Secure` in production,
  path `/`, 30-day sliding TTL with a 90-day hard cap.
- Admin panel cookie: `HttpOnly`, `SameSite=Strict`, 8-hour TTL, separate
  credential from the family app.
- **There are no CSRF tokens.** The family listener's `Lax` mode and the admin
  listener's `Strict` mode are the entire CSRF defence, and for a LAN-trusted
  household client there is no cross-origin embedding scenario to defend
  against. Mutating routes use JSON bodies, not form posts. If Bookle ever
  mounts a hostile third-party client origin, this section must be revisited
  and double-submit tokens added; the decision is recorded in
  `docs/risk-register.md` (R3) and `specs/43-production-readiness.md`.
- Media URLs (`/api/.../stream`, `/cover`) carry short-lived, single-purpose
  bearer tokens (5-minute TTL, profile-scope) as query parameters because
  native `<audio>` cannot send headers. They are redacted from logs, bound to
  one profile and one resource, and are not usable as session credentials.

## Accepted risks

Not everything is fixed; some things are documented as accepted, with an owner
and a review date. See `docs/risk-register.md`:

- **R1** — no monitoring/alerting; a dead household host is discovered manually.
- **R2** — backups are same-site only (weekly age-encrypted `pg_dump`, tested
  annual restore); host/NAS loss destroys listening history; media is
  re-acquirable.
- **R3** — CSRF posture as above (documented, no tokens).
- **R4** — the hosted demo is a public beta with known accepted risks, not a
  staffed service.

## What would get a fix fastest

The highest-impact reports, in rough order: anything that lets one profile
read or write another profile's data (progress, history, shelf, wishlist),
anything that escapes the library-root file confinement, anything that mints
or replays a session token, and anything that turns the admin panel into a
write path to the host. Dependency advisories for the runtime stack are
handled routinely via `npm audit` and CI.

## Breach contact (GDPR Art. 33/34)

If personal data is exposed on a hosted instance, the controller and the
report path are: the maintainer, via the reporting channels above, within
about a week (aiming for the 72-hour Art. 33(1) window on hosted instances).
The household deployment's controller is the household itself; the same
channels reach the operator. Processor-side (Supabase/Render for the demo),
the respective DPAs and the records in `docs/roa.md` apply — Supabase and
Render are listed in `docs/processors.md`.
