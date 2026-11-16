# Rolling back the demo (spec 43 phase 4.2)

Five minutes, top to bottom. The rule: **roll the app back; never roll the
database back.** Migrations in this project are additive (ADR 019), so an old
server against the current schema is supported; a rolled-back schema is not
something to improvise against a live demo people are using right now.

## When to roll back

- Post-deploy smoke check fails (`scripts/smoke-demo.sh` from this repo).
- Error rate or login failures spike after a deploy.
- Anything that touches auth, sessions or the schema misbehaves for real users.
  When in doubt, roll back first, diagnose second.

## Steps

1. **Find the last known-good tag:** `git tag --sort=-creatordate` — the
   demo shipped from a tagged release (v0.2.0 and later). Pick the previous tag,
   not `master`.
2. **Redeploy that tag on Render.** Either:
   - Dashboard → service → "Manual Deploy" → pick the commit of the previous
     tag, or
   - `render deploys create --service <service-id> --commit <sha-of-tag>` with
     the Render CLI (optional; dashboard is fine).
   Watch the deploy log; the build is ~4–6 minutes.
3. **Wait for green:** `scripts/smoke-demo.sh` against the live URL:
   `DEMO_URL=https://audiobook-manager.onrender.com ./scripts/smoke-demo.sh`
   — all checks must pass.
4. **Confirm the app actually came back:** open the demo in a browser, sign in
   (Google or a demo account), play a few seconds of a book, check the admin
   panel (`/admin`) opens. These are the three flows that break loudest.
5. **Tell people something happened** — reply on the original incident channel;
   for the demo, a note in the README's status section is enough.
6. **Diagnose from the bad build, not from prod:** reproduce locally
   (`make start`, point the client at the demo-ish setup) or on a throwaway
   branch; do not "just fix forward" if the failure mode is unknown.
7. **Afterwards:** add a line to `docs/drills.md` if the rollback was during a
   backup window (relevant to erasure lag), and to the retrospective/PR.

## If the bad deploy also ran a schema migration

Rolling the app back is still correct — the migration stays, the old code
runs against the new schema (additive by design). If, exceptionally, a
destructive migration shipped (it must not — review migrations before merge),
do **not** restore a pre-migration backup over the live demo to "fix" it: that
destroys audience data. Stop, restore to a scratch database instead, merge
additively, and only then plan a cutover with all hands.

## Household rollback (different, simpler)

Compose deployment: check out the previous tag, `docker compose build && make
restart`, or `docker compose pull` if you ship images. Same rule — additive
schema, old code runs fine.

## What this procedure does not cover

Supabase incidents, Render platform incidents, DNS/TLS at the Render edge, and
any data corruption discovered *between* deploys — those follow
`docs/backup-restore.md` (restore) and the post-incident flow in
`docs/breach-procedure.md` (if personal data was implicated).
