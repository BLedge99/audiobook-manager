# Backup and restore runbook (spec 43 phase 3)

Same-site only, encrypted, tested. This is not 3-2-1 — that decision and its
rationale are in `decisions/037-backup-strategy.md`. The risk of host/NAS loss
is recorded as **R2** in `docs/risk-register.md`.

> **Your `age` private key losing key custody = every backup is gone.** It
> lives in your password manager; one printed recovery sheet sits somewhere
> other than the host (a safe, a letter box, a relative's drawer). The public
> recipient is all the backup script needs — the private key never goes near
> the server.

## What is backed up

The **database only** — profiles, sessions, listening history, favourites,
wishlist, shelves, enrichment state. Media files are re-acquirable and stay
out; covers re-fetch on demand. Configuration lives in the repo; secrets live
in your password manager, never in the repo.

## What you need on the host

- `pg_dump` (postgresql-client), `age`, and outbound access to the database.
- A recipient: `age-keygen` once, keep the public key in the script call or an
  env file (`chmod 600`), e.g. `/etc/bookle/backup.env`:
  `DATABASE_URL=…`, `AGE_RECIPIENT=age1…`, `BACKUP_DIR=/data/backups`.

## Weekly backup (cron)

```cron
# /etc/cron.d/bookle-backup — Sunday 04:30, quiet hours
30 4 * * 0  postgres  . /etc/bookle/backup.env && pg_dump "$DATABASE_URL" --format=custom | age --recipient "$AGE_RECIPIENT" --output "$BACKUP_DIR/bookle-$(date -u +\%Y-\%m-\%d).dump.age" && /opt/bookle/scripts/backup-db.sh
```

or the script directly (it does dump + encrypt + prune + digest):

```sh
. /etc/bookle/backup.env && /opt/bookle/scripts/backup-db.sh
```

Check the output monthly: seven `bookle-*.dump.age` files, newest dated this
week, `sha256sum` present. On a Raspberry Pi prefer the timer over cron so it
catch-up-fires after downtime; both are documented here because home machines
get switched off a lot.

## Restore (the drill — `docs/drills.md` logs every one)

Always into a **scratch** database first. Never restore straight over the
live one without taking a fresh dump of it first.

```sh
# 1. Pick the dump (newest is fine unless you need a specific point).
ls -1t /data/backups/bookle-*.dump.age | head -5

# 2. Decrypt and list — proves the file and your key are good.
age --decrypt -i age.key /data/backups/bookle-2026-11-16.dump.age | pg_restore --list | head

# 3. Scratch Postgres (Docker).
docker run --rm -d --name bookle-restore -e POSTGRES_PASSWORD=restore -p 55432:5432 postgres:16-alpine
docker exec bookle-restore sh -c 'for i in $(seq 1 30); do pg_isready -U postgres && break || sleep 1; done'

# 4. Restore into it.
docker exec -i bookle-restore sh -c 'pg_restore --username=postgres --clean --if-exists --no-owner --no-privileges --dbname=postgres' \
  < <(age --decrypt -i age.key /data/backups/bookle-2026-11-16.dump.age)

# 5. Verify: every table has the same row count as the source (spot-check the ones that matter).
docker exec bookle-restore psql -U postgres -c \
  "select 'Profile' as t, count(*) from \"Profile\" union all
   select 'ListeningHistory', count(*) from \"ListeningHistory\" union all
   select 'Favourite', count(*) from \"Favourite\" union all
   select 'MediaItem', count(*) from \"MediaItem\";"

# 6. Tear down.
docker rm -f bookle-restore
```

The full application-level smoke test (boot the server against the restored
database, log in, `GET /api/audiobooks`, one `PUT .../progress`) is part of the
annual drill; see `docs/drills.md` for how it went most recently.

## GDPR: erased data outlives the live database by up to ~28 days

An erasure removes rows from the live database immediately. The weekly-rotating
backups drop those rows within ~28 days (7-dump rotation). Two rules follow:

1. **A restore must not resurrect an erased person.** Before pointing the
   live app at a restored database, re-apply any pending erasures (the erasure
   audit in `docs/GDPR-AUDIT.md` lists what was erased when). If you restore
   during an incident, treat the restore as stale by definition and re-run the
   erasure jobs from `docs/retention.md`.
2. Erasure requests made **after** a backup is taken but **before** it ages out
   of rotation are honoured once the copy falls off the 7-dump ladder. Tell the
   data subject that in the response to their request.

## If the host/NAS is lost

You lose up to a week of listening history. Media re-acquires from its sources.
The restore path above is how you get back to a running system on replacement
hardware; the authorisation for that — `.env.production` / `.env` values, the
`age` key, this repository — lives with you, not the host.

## Upgrading to offsite (when you change your mind)

One remote and a one-line script change:

```sh
rclone copy "$BACKUP_DIR" remote:bookle-backups --include 'bookle-*.dump.age' --crypt ...
```

(or `restic -r b2:bookle-backups`). The encryption here is already age-based,
so the offsite copy needs no additional crypto. Then update this file,
`docs/risk-register.md` (R2 disappears), and ADR 037 gets superseded.
