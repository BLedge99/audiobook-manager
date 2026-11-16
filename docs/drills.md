# Backup restore drills

One entry per drill. A backup that has never been restored is a hope, not a
backup. Spec 43 phase 3.2: baseline drill at the v0.2.0 release, then
**annually** (put a calendar reminder in — the repo cannot remind you).

If the live database has to be pointed at a restored dump (host replacement,
disaster): **re-apply any erasures granted since that dump was taken** before
exposing the app (see `docs/retention.md`, Backups). Restoring old personal
data is the one way a drill or disaster can silently undo an erasure.

---

## 2026-11-16 — baseline drill (synthetic data, scratch Postgres 16)

**Context.** No production dump exists yet (the v0.2.0 release gate counts on
the first two weekly dumps). This drill ran against a **synthetic** scratch
PostgreSQL 16 instance built from the repo's real migration history, seeded
with: 1 library root, 1 book, 2 profiles, 1 listening-history row, 1 favourite,
1 shelf entry. The value proven here is the *procedure* — dump, encrypt,
wipe, restore, verify, boot — not any specific production dataset.

**What was run (auditor's summary):**

1. `prisma migrate deploy` applied all 12 migrations to a fresh container
   (synthetic source).
2. `age` key generated for the drill only; recipient recorded.
3. Backup executed with the actual `scripts/backup-db.sh` (bind-mounted into a
   disposable container, 10 fabricated old dumps to exercise the pruning path):
   dump → custom format, gzip-9 → `age` ciphertext, SHA-256 printed, retention
   pruned to the 7 newest files, old fakes deleted.
4. `age --decrypt | pg_restore --list` verified the archive (309 TOC entries;
   311 for the script-written dump).
5. **Destructive verification:** `DROP SCHEMA public CASCADE; CREATE SCHEMA` —
   every table gone (`\dt` = "Did not find any relations").
6. `pg_restore --clean --if-exists --no-owner --no-privileges` into the wiped
   schema.
7. Post-restore counts match the seeded state exactly: profiles 2, books 1,
   listening history 1, favourites 1, roots 1 (shelf 0 pre-restore, 1 after the
   manually-added entry).
8. **Boot + smoke against the restored database** (production build,
   `NODE_ENV=production`): `/api/health` 200 → seeded admin password set via the
   server's own hasher → `POST /api/auth/login` 200 → `GET /api/audiobooks`
   returned the book with the restored `position` and a `PUT .../progress`
   round-trip persisted (position 88.5 survived).

**Outcomes / fixes made during the drill:**

- `prisma migrate deploy` against a fresh database is clean — no drift between
  the 12 migrations.
- A raw-SQL seed of `MediaItem` violated a NOT NULL constraint on `updatedAt`
  (Prisma `@updatedAt` is app-set, not SQL-defaulted). Recorded here so the
  next synthetic drill seeding by hand knows to supply it.
- Backup isolation check: restore worked identically from the script-written
  dump as from the manual dump.

**Not proven, explicitly:** behaviour against the real production dataset
(volumes, index sizes, the RLS migration's side effects on a loaded schema —
the drill's RLS-enabled empty schema was owned by the restoring role, as
production's is; an application smoke was not re-run against the live-shape
data volumes).

**Gaps closed in this drill vs the runbook:** none found in the runbook
itself; `docs/backup-restore.md` matches what was actually typed.

**Next drill:** after the first real weekly dump lands, restore that dump and
repeat steps 4–8 against the production-shaped data; log it as the next entry.
Annual thereafter.
