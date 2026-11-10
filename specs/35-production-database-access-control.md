# Spec 35 — Production database access control

## Purpose

Supabase reported a critical finding on 2026-11-08: tables in the `public`
schema are publicly accessible because Row-Level Security is not enabled.

The project uses Supabase as a managed PostgreSQL host and, optionally, as
private object storage. It does not use Supabase Auth, PostgREST, or the
project's public `anon` key — the server authenticates its own sessions
(ADR 016, ADR 023) and talks to the database directly through Prisma.

That makes the finding a real exposure rather than a formality. Supabase grants
every table in the `public` schema to the `anon` and `authenticated` roles by
default. With RLS disabled, anyone holding the project's public `anon` key —
which is designed to be public — can read and write the tables through
`https://<project-ref>.supabase.co/rest/v1/<table>`: profiles, e-mail
addresses, password hashes, session token hashes, listening history, favourites,
and the whole catalogue. Writing is worse than reading: a row in `Profile` can
be rewritten with a password hash the attacker controls, and a row in
`AdminCredential` can be replaced outright.

## Requirements (must hold)

1. **Every table in the `public` schema has Row-Level Security enabled.** No
   table in the project may sit outside it, including one created through the
   Supabase dashboard rather than through Prisma.
2. **No table is reachable through the Supabase API.** The `anon` and
   `authenticated` roles hold no table, sequence, or function privileges in the
   `public` schema, and the default privileges that would grant them to future
   tables are revoked as well.
3. **The server keeps working.** The server connects as the role that owns the
   tables, which is exempt from RLS; Supabase's `postgres` role additionally
   carries `BYPASSRLS`. The optional Storage sync uses the service-role key,
   which bypasses RLS too.
4. **RLS is never forced.** `FORCE ROW LEVEL SECURITY` would bind the owner
   role and stop the server reading its own data.
5. **No policy grants access.** Deny-by-default is the correct posture here:
   the application has no PostgREST access path, so there is nothing to allow.
6. **The fix is in the repository.** The change is a PostgreSQL migration in
   the Prisma history, applied by the same `prisma migrate deploy` that runs at
   boot, so a redeploy cannot undo it.

## Acceptance criteria

1. `server/prisma/migrations/` contains a migration that enables RLS on every
   table declared in `prisma/schema.prisma`, sweeps the rest of the `public`
   schema, and revokes the `anon`/`authenticated` grants on both existing and
   future objects.
2. The server suite fails if a model is added to `prisma/schema.prisma` without
   an RLS statement in the PostgreSQL migration history, if any migration
   forces RLS, if the grants are not revoked, or if the schema sweep is
   removed.
3. **The SQLite history stays free of RLS statements:** SQLite has no row-level
   security, so this is a PostgreSQL-only change and the SQLite twin is
   unchanged.
4. **A new table arrives protected.** A migration that adds a table also
   enables RLS on it, in the same migration. The server suite fails when a
   model exists without an RLS statement in the PostgreSQL history.
5. **A table created outside Prisma is unreachable even before it is
   protected.** The revoked default privileges mean a table added later in the
   dashboard holds no `anon`/`authenticated` grants, so the public API cannot
   read or write it; the sweep below is re-run to give it RLS as well and to
   clear the platform's own finding.
6. **The migration is idempotent**, so the operator may run it by hand in the
   Supabase SQL editor before the next deploy; `prisma migrate deploy` then
   records it without failing.
7. The operator guide explains how to confirm the result in the Supabase
   dashboard, how to re-run the sweep, and what to do if the server stops
   reading data afterwards.

## Not in this spec

- Moving authentication to Supabase Auth. The project authenticates its own
  sessions, and adopting a hosted identity provider is a different decision
  with its own migration.
- A dedicated least-privilege application role for the server. The server
  currently connects as the owner; a narrower role would need `BYPASSRLS` or a
  full policy set, which is a larger change than the exposure requires.
- Rotating the database password or the service-role key. Neither is part of
  this finding.
