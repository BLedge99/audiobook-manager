# Prisma databases

Production is **PostgreSQL**. Local development and the test suite are
**SQLite**. Both are Prisma schemas with Prisma-managed migrations; see
`decisions/019-postgres-production-sqlite-local.md` for why.

| Target | Schema | Migrations | Client |
| --- | --- | --- | --- |
| PostgreSQL (prod) | `prisma/schema.prisma` | `prisma/migrations/` | `npm run db:generate` |
| SQLite (dev/test) | `prisma/sqlite/schema.prisma` | `prisma/sqlite/migrations/` | `npm run db:sqlite:generate` |

Prisma supports one provider per schema, and the provider is baked into the
generated client. Always name the schema; the default is PostgreSQL and will
fail against a `file:` URL.

## Changing the model

1. Edit `prisma/schema.prisma` (the canonical model).
2. Derive the SQLite twin: `npm run db:sqlite:sync`.
3. Create both migrations:
   ```bash
   npx prisma migrate dev --schema prisma/schema.prisma
   npx prisma migrate dev --schema prisma/sqlite/schema.prisma
   ```
4. Run `npm test`. It fails if the twin is stale or the SQLite migrations do
   not produce the SQLite schema.

## Local development

```bash
npm run db:sqlite:migrate   # apply SQLite migrations to DATABASE_URL
npm run db:sqlite:generate  # generate the SQLite client
npm run dev                 # predev does both of the above
```

`DATABASE_URL="file:./dev.db"` is relative to the schema that generated the
client, so it lands in `prisma/sqlite/dev.db`.

Docker Compose does the same two steps before starting Fastify.

## Production

The production image generates the PostgreSQL client and runs
`prisma migrate deploy --schema prisma/schema.prisma` before boot. Set
`DATABASE_URL` to the PostgreSQL connection string (see
`.env.production.example`).

To apply production migrations by hand:

```bash
npm run db:prod:migrate
```

## Tests

`src/test-support/global-setup.ts` generates the SQLite client once and builds
`node_modules/.cache/audiobook-tests/template.db` with
`prisma migrate deploy --schema prisma/sqlite/schema.prisma`. Each test file
copies the template. Do not add `prisma generate` or `db push` to a test file:
parallel workers would race on the shared generated client.
