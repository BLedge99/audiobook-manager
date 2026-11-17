# ADR 037 — Same-site, age-encrypted weekly backup (deviating from 3-2-1 deliberately)

## Status

Accepted 2026-11-16. Spec: [`specs/43-production-readiness.md`](../specs/43-production-readiness.md), phase 3.
Related: [`specs/44-offline-progress-sync.md`](../specs/44-offline-progress-sync.md), ADR 019 (PostgreSQL production), GDPR Art. 32.

## Context

The production database (Supabase-managed PostgreSQL for the demo; operator-chosen
PostgreSQL for the household) is the only genuinely irreplaceable state in the
system: profiles, sessions, listening history, favourites, library membership,
enrichment. Audio files are re-acquirable (LibriVox, purchases, re-rips) and are
**out** of backup scope.

The standard guidance says: 3 copies, 2 media, 1 offsite, 1 immutable, zero
errors through verification (3-2-1-1-0), and PostgreSQL's own documentation
recommends continuous WAL archiving + PITR for serious installations. Both were
considered, and both were rejected for this deployment:

- The household has no second site, no cloud account it wants to hold, and a
  solo operator whose threat model is a misbehaving disk or an rm gone wrong —
  not a regional provider outage, fire, or a targeted attacker (this is a
  read-only-mounted home LAN service; there is no privileged write path for an
  attacker to corrupt the host with).
- A backup that requires daily discipline (rotating offsite media) silently
  decays into an absent backup; a weekly encrypted dump on the same host is a
  procedure the operator will actually run.
- Media stays out: at multi-hundred-GB scale, media backup is noise the NAS
  already provides snapshot/RAID for; the irreplaceable data is kilobytes per
  profile.

The decision therefore optimises for "restores cleanly from what exists", not
"survives every disaster class". That is a known, accepted trade — not an
oversight.

## Decision

1. **Weekly `pg_dump`** (custom format, `--compress=9`), piped through
   `age` to a file on the **same host/NAS** as the app (or its backup volume).
2. **Retention: the 7 newest dumps** (weekly cadence ≈ 49 days). Erased data
   leaves backups within ~49 days; `docs/retention.md` documents this lag and
   the erasure procedure. The two-tier 4-weekly + 3-monthly plan was never
   built; see the addendum below.
3. **No offsite copy.** Host/NAS loss, ransomware, or a volume wipe destroys
   listening history. Accepted knowingly; recorded as risk R2 with a review
   date (2027-05-16) and a documented upgrade path (one rclone/restic remote to
   any second site or object store; commands sketched in
   `docs/backup-restore.md`, not enabled).
4. **Restore drills are annual** into a disposable Docker PostgreSQL
   (`docs/drills.md`), plus one baseline drill at the v0.2.0 release. A backup
   that has never been restored is a hope, not a backup.
5. **Encryption: `age` with a public recipient key;** the private key lives in
   the operator's password manager plus one printed recovery sheet. Losing it
   loses every backup — the runbook leads with that sentence. Ciphertext only
   ever rests on the host; Art. 32 rest-encryption is satisfied without
   trusting the storage layer.
6. The production demo additionally rides on **Supabase's managed backups** as
   its primary tier (household plan-dependent); this ADR's dump is the
   application-owned second copy for the household, and the honest floor for
   the demo without relying on the vendor.

## Alternatives considered

- **3-2-1-1-0 with immutable offsite copy (B2/R2/Wasabi):** ~cents/month and
  closes host-loss. Rejected only on operator appetite: introduces an account,
  keys, and rotation discipline. The upgrade path is documented (see point 3)
  and is the recommended 2027 review outcome if R2 is revisited.
- **WAL archiving / PITR (pgBackRest, Barman):** correct answer for an
  RPO ≈ 0 service. Weekly loss of listening history is tolerable here; the
  tooling and maintenance are not proportionate. Reconsider only if Bookle ever
  serves paying users or legal retention duties.
- **Supabase Storage as backup:** sync ≠ backup; it propagates deletes and
  corruption. Rejected outright.
- **Unencrypted dumps in a private bucket:** Art. 32 weakness; rejected.
- **No backups:** unacceptable; listening history is personal data and its loss
  is unrecoverable.

## Consequences

- Recovery point: ≤ 7 days of listening history may be lost to host failure;
  ordinary corruption/deletion recovers to ≤ 7 days as well.
- Recovery time: ~15 minutes (dump decrypt + `pg_restore` into scratch
  Postgres + smoke test per runbook).
- Erasure lag in backups: ~49 days, documented; restore rehearsals must not
  resurrect erased records into live use without re-applying pending erasures.
- The demo's honest position improves from "whatever Supabase plan gives us"
  to "managed primary + one verified application-level copy".
- Household acceptance criterion: **two successful weekly dumps plus one
  baseline drill, logged, before v0.2.0 is tagged.**
- If the operator later enables the offsite path, this ADR is superseded, not
  amended — the superseding ADR says so in its status line.

## Addendum — retention as implemented (2026-11-17, spec 45 phase 4)

The decision's "4 weekly + 3 monthly" tier was never built; the shipped
script keeps the **7 newest** dumps (`ls -t books/*.dump.age | tail -n +8`),
which at a weekly cadence is ≈ **49 days** for the oldest survivor. An
erasure honoured on D is guaranteed absent from backups by roughly D + 49
days, not D + 28. `docs/retention.md`, `docs/roa.md`,
`docs/backup-restore.md` and this file were corrected to say so; spec 43's
phase-3 text describes the intent as read at the time, not the shipped
reality. The two-tier rotation remains available as a deliberate future
change to the script, not as documentation of today's.
