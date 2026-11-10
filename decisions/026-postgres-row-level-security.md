# ADR 026 — Row-Level Security on the production database, and no Supabase API access

## Status

Accepted 2026-11-10. Follows ADR 019 (PostgreSQL production, SQLite local) and
ADR 025 (Supabase Storage for durable media). Spec:
[`specs/35-production-database-access-control.md`](../specs/35-production-database-access-control.md).

## Context

Supabase flagged the production project on 2026-11-08: tables in the `public`
schema are publicly accessible because Row-Level Security is disabled.

The project uses Supabase as a managed PostgreSQL host and, optionally, as
private object storage. It does not use Supabase Auth, PostgREST, or the
`anon` key. Supabase nevertheless grants every table in the `public` schema to
the `anon` and `authenticated` roles by default, so the public API could read
and write every profile, password hash, session hash and catalogue row.

The application has no need for that API, so the honest posture is deny-all.

## Decision

- Enable Row-Level Security on every table in the `public` schema, and revoke
  the `anon` and `authenticated` grants on tables, sequences and functions —
  both the ones that exist and the default privileges that would grant them to
  future objects.
- Add **no policies**. With RLS on and no policy, the API roles see zero rows
  and may write nothing, which is exactly what an application with no
  PostgREST access path wants.
- Do **not** use `FORCE ROW LEVEL SECURITY`. The server connects as the role
  that owns the tables; forcing RLS would bind the owner and stop the server
  reading its own data. Supabase's `postgres` role carries `BYPASSRLS` as well,
  and `service_role` keeps working for the optional Storage sync.
- Ship the change as a PostgreSQL migration in the Prisma history, so it is
  applied by the `prisma migrate deploy` that already runs at boot and cannot
  be undone by a redeploy.
- Keep the statements idempotent, so an operator can apply the same SQL by
  hand in the Supabase SQL editor before the next deploy.

## Alternatives considered

- **Write RLS policies for `authenticated` and use Supabase Auth.** Rejected:
  the application has its own session model (ADR 016, ADR 023) and would gain
  a second identity system to keep in step with the first.
- **Revoke the grants only, without RLS.** Rejected: RLS is the control the
  platform's own security advisor checks, and it keeps working if a grant is
  added back by a later migration or a dashboard action.
- **Enable `FORCE ROW LEVEL SECURITY` for defence in depth.** Rejected: it
  binds the owner role the server connects as, which would break the
  application rather than protect it. The owner exemption is the mechanism
  this decision relies on.
- **A dedicated application role with `BYPASSRLS` or a policy set.** Deferred:
  it is the more precise design, but it is a larger change than the exposure
  requires, and the app's own session layer already provides access control.

## Consequences

- The public Supabase API can no longer read or write the application's data.
  Anything that relied on it — nothing in this repository does — stops working.
- The server is unaffected: it connects as the owner, which is exempt from
  RLS. A production database whose `DATABASE_URL` points at a non-owner role
  would need `BYPASSRLS` or policies; that must be checked before the
  migration is applied.
- New tables need an `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` statement in
  the PostgreSQL history. The server suite fails when one is missing, and the
  sweep in the same migration covers any table created outside Prisma.
- The optional Supabase Storage upload path is unaffected: it uses the
  service-role key, which bypasses RLS.
