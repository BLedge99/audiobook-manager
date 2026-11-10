# Production database access control

How the production Supabase project is locked down, how to check it, and what
to do if the server stops reading data afterwards.

Spec: [`specs/35-production-database-access-control.md`](../specs/35-production-database-access-control.md).
ADR: [`decisions/026-postgres-row-level-security.md`](../decisions/026-postgres-row-level-security.md).

## What the finding means here

Supabase reported on 2026-11-08 that tables in the `public` schema were
publicly accessible because Row-Level Security was not enabled.

This project uses Supabase for two things: a managed PostgreSQL database, and
(optionally) private object storage for durable audio. It does **not** use
Supabase Auth, PostgREST, or the public `anon` key — the server authenticates
its own sessions and talks to the database directly through Prisma.

The exposure was still real. Supabase grants every table in the `public`
schema to the `anon` and `authenticated` roles by default. With RLS disabled,
anyone holding the project's public `anon` key could read and write the tables
through `https://<project-ref>.supabase.co/rest/v1/<table>` — profiles,
e-mail addresses, password hashes, session token hashes, listening history and
the whole catalogue. Writing matters more than reading: a `Profile` row can be
rewritten with a password hash the attacker controls, and an `AdminCredential`
row can be replaced outright.

## The fix

The change lives in the repository as a PostgreSQL migration:

```
server/prisma/migrations/20261110120000_enable_row_level_security/migration.sql
```

It does three things:

1. Enables RLS on every table the application owns, and sweeps the rest of the
   `public` schema so a table created through the dashboard is covered too.
2. Revokes the `anon` and `authenticated` grants on tables, sequences and
   functions — for the objects that exist now and for the ones created later.
3. Adds no policies. Deny-by-default is right here: the application has no
   PostgREST access path, so there is nothing to allow.

RLS is **not** forced. The server connects as the role that owns the tables,
which is exempt from RLS; Supabase's `postgres` role also carries `BYPASSRLS`.
The optional Storage sync keeps working because the service-role key bypasses
RLS.

## Applying it

The production image runs `prisma migrate deploy` before the server starts, so
the next deploy applies the migration by itself.

To close the exposure before a deploy, run the same SQL by hand in the
**Supabase dashboard → SQL Editor → New query**. Copy the contents of the
migration file and run it. Every statement is idempotent, so a later
`prisma migrate deploy` records the migration without changing anything.

## Checking the result

**In the dashboard:** Table Editor → any table → the RLS toggle is on. Project
Settings → Advisors → the `rls_disabled_in_public` finding is gone.

**In the SQL editor:**

```sql
select c.relname, c.relrowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p')
order by c.relname;
```

Every row must show `relrowsecurity = true`.

**End to end**, with the project's public `anon` key (Settings → API):

```bash
curl -s "https://<project-ref>.supabase.co/rest/v1/MediaItem?select=id&limit=1" \
  -H "apikey: <anon-key>" -H "Authorization: Bearer <anon-key>"
```

The answer must be `[]` (or a permission error), not a row. The same request
against `/rest/v1/Profile` must not return e-mail addresses or password hashes.

## A table added later

A table created after the migration — through the Supabase dashboard, or by a
later Prisma migration — is not covered by the sweep above.

- **A Prisma migration** must enable RLS on the new table in the same
  migration: `ALTER TABLE "NewTable" ENABLE ROW LEVEL SECURITY;`. The server
  suite fails when a model in `prisma/schema.prisma` has no such statement in
  the PostgreSQL history.
- **A dashboard table** cannot be read or written through the public API even
  before it has RLS: the revoked default privileges mean `anon` and
  `authenticated` hold no grants on it. It will still be reported by the
  platform's own advisor, which checks the RLS flag. Re-run the sweep to give
  it RLS as well:

  ```sql
  DO $$
  DECLARE
    target record;
  BEGIN
    FOR target IN
      SELECT c.relname AS name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
    LOOP
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target.name);
    END LOOP;
  END $$;
  ```

## Before applying: which role does the server connect as?

RLS exempts the table owner. If `DATABASE_URL` uses a role that does **not**
own the tables and does not have `BYPASSRLS`, the server will start returning
empty results and permission errors after the migration.

Check it in the SQL editor:

```sql
select current_user, session_user;
```

The expected answer is `postgres` (or another role that owns the tables). If
it is not the owner, either point `DATABASE_URL` at the owner role or grant the
bypass:

```sql
alter role <app-role> bypassrls;
```

## If the server stops reading data after the migration

1. Check the server log for `permission denied for table` or empty result sets.
2. Confirm the role from the step above.
3. Confirm the table actually has RLS enabled, and that the connection role is
   the owner.
4. As a last resort, and only to get the server running again while you
   investigate, disable RLS on the affected table:

   ```sql
   alter table "<TableName>" disable row level security;
   ```

   Do not leave it that way: it reopens the exposure for that table. Fix the
   role instead.

## Undoing the change

Not recommended. If the database must be reachable through the Supabase API
again — for example because Supabase Auth is adopted later — that is a
different design (ADR 026), and it needs policies rather than a plain
`DISABLE ROW LEVEL SECURITY`.

## Storage

The optional audio bucket is separate from this finding, and the server checks
it at startup: the bucket must be private
(`bucket.public === false`), the service-role key stays server-side, and
browsers only ever receive short-lived signed upload URLs.

```sql
select id, name, public from storage.buckets;
```

`public` must be `false` for the audiobook bucket.
