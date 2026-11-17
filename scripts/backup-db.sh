#!/usr/bin/env bash
# Spec 43 phase 3.1 — weekly encrypted PostgreSQL backup (same-site, accepted
# risk R2; see docs/risk-register.md and docs/backup-restore.md).
#
# Usage:
#   DATABASE_URL=postgresql://... AGE_RECIPIENT=age1... BACKUP_DIR=/data/backups ./scripts/backup-db.sh
#
# Writes bookle-<UTC-date>.dump.age into BACKUP_DIR, prunes beyond the 7
# newest dumps (weekly cadence ≈ 49 days for the oldest survivor), and prints
# the SHA-256 of the written dump. No pipelines: the dump lands in a temp
# file first, and an empty dump refuses to become a backup (spec 45, phase 1 —
# a silent empty backup is indistinguishable from seven good ones).
# Encryption key: the operator's `age` private key, held in their password
# manager plus one printed recovery sheet. Losing it loses every backup; the
# public key (AGE_RECIPIENT) is all this script needs.
set -euo pipefail

: "${DATABASE_URL:?set DATABASE_URL to the production PostgreSQL connection string}"
: "${AGE_RECIPIENT:?set AGE_RECIPIENT to the age public key backups are encrypted to}"
: "${BACKUP_DIR:?set BACKUP_DIR to the directory holding backups}"

STAMP=$(date -u +%Y-%m-%d-%H%M%S)
DEST="$BACKUP_DIR/bookle-$STAMP.dump.age"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

command -v pg_dump >/dev/null 2>&1 || { echo "backup-db.sh: pg_dump not found (install postgresql-client)" >&2; exit 1; }
command -v age >/dev/null 2>&1 || { echo "backup-db.sh: age not found (install age, or see docs/backup-restore.md)" >&2; exit 1; }

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

echo "[backup] dumping (custom format, compressed)…"
pg_dump "$DATABASE_URL" --format=custom --compress=9 --no-owner --no-privileges > "$TMP"
if [ ! -s "$TMP" ]; then
  echo "backup-db.sh: pg_dump produced no output — refusing to write a backup" >&2
  exit 1
fi

# The script holds only the public half of the age key, so it cannot open its
# own archives: the strongest guarantee it can give is a non-empty input and a
# successful age run. Decrypt-verification stays with the restore drill.
age --recipient "$AGE_RECIPIENT" --output "$DEST" "$TMP"
if [ ! -s "$DEST" ]; then
  echo "backup-db.sh: age produced no output — not rotating anything" >&2
  rm -f "$DEST"
  exit 1
fi

echo "[backup] $(wc -c < "$DEST") bytes written"
sha256sum "$DEST"

# Retention: keep the 7 newest dumps (weekly cadence ≈ 49 days), delete the
# rest. Names are timestamped, so `ls -t` is correct. Only ever runs after a
# verified write — a failed run deletes nothing.
ls -1t "$BACKUP_DIR"/bookle-*.dump.age 2>/dev/null | tail -n +8 | while IFS= read -r old; do
  echo "[backup] pruning $old"
  rm -- "$old"
done

echo "[backup] wrote $DEST (retention: 7 newest dumps)"
