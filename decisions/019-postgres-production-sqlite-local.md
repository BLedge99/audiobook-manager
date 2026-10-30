# ADR 019 — PostgreSQL production, SQLite local and test, one model

## Status

Accepted. Supersedes ADR 001 (`001-database-sqlite-first.md`).

## Context

The household deployment moved to PostgreSQL (managed Supabase), but the test
suite and local development were still built around SQLite. Prisma allows one
datasource provider per schema and bakes that provider into the generated
client, so the two targets cannot share a single generated client or migration
history.

The interim arrangement generated the client from whichever schema ran last:
fourteen integration test files each ran `prisma db push` (which also runs
`prisma generate`) in `beforeAll`, concurrently, against the same
`node_modules/.prisma/client`. A run passed or failed depending on which
provider won, and a fresh `prisma generate` for production made every
integration test fail with:

```
the URL must start with the protocol `postgresql://` or `postgres://`
```

## Decision

PostgreSQL is the production database. SQLite is the local-development and test
database. Both are Prisma, and both are migrated with Prisma Migrate.

- `prisma/schema.prisma` is the canonical model and the PostgreSQL schema.
  `prisma/migrations/` is its production migration history.
- `prisma/sqlite/schema.prisma` is generated from the canonical schema by
  `server/scripts/sync-sqlite-schema.mjs`. Only the datasource provider line
  changes, so the two files cannot describe different models.
  `prisma/sqlite/migrations/` is its local/test history.
- Scripts name the schema explicitly (`--schema prisma/schema.prisma` or
  `--schema prisma/sqlite/schema.prisma`). No script relies on the default
  schema, because the default is the wrong database for half the project.
- The Vitest global setup generates the SQLite client once and builds a
  template database from the SQLite migrations. Each test file copies the
  template. Test files never generate a client or run `db push`.
- Tests that guard the arrangement fail when the schemas drift or when the
  SQLite migrations stop matching the SQLite schema
  (`src/database-schema.test.ts`).

## Alternatives considered

- **Run the tests against PostgreSQL** (Testcontainers or a service in CI).
  Closer to production, but it makes every `npm test` require Docker or a
  server, which the project explicitly avoids for local work, and it would not
  exercise the SQLite path the development stack actually uses.
- **A single schema with an env-driven provider.** Prisma does not support
  `provider = env(...)`.
- **Use `db push` for SQLite and migrations only in production.** This hides
  drift: a model change without a migration would pass tests and fail the
  production deploy. The SQLite template is built with `migrate deploy` so the
  same class of mistake fails locally first.
- **Two hand-maintained schema files.** The model would drift the first time
  someone forgot the second file. The sync script and its test make drift
  impossible to merge.

## Consequences

- A model change needs two migrations: `prisma migrate dev --schema
  prisma/schema.prisma` for production and the same command for
  `prisma/sqlite/schema.prisma` (after `npm run db:sqlite:sync`). The SQLite
  drift test fails until both exist.
- `npm run db:sqlite:generate` must run before starting a local server, and the
  production image must generate the client from `prisma/schema.prisma`. Both
  are wired into `predev`, Docker Compose, and `Dockerfile.prod`.
- The SQLite history is a squashed baseline. It is a development convenience,
  not a data-migration path; production data migrations live only in the
  PostgreSQL history.
