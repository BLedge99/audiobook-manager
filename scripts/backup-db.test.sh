#!/usr/bin/env bash
# Spec 45, phase 1 — the backup must never silently succeed on nothing.
#
# Stubs `pg_dump` and `age`; never touches a database, never needs a real
# age key. Exists for CI and for the operator's own machine.
#
# Cases:
#   A. pg_dump exits 1            -> script exits non-zero, writes NOTHING,
#                                    and deletes nothing that exists
#   B. pg_dump produces bytes     -> script exits 0, one non-empty archive
#   C. pg_dump produces nothing   -> script exits non-zero, writes NOTHING
#   D. retention prunes ONLY the 7 newest, and only on the success path
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/stubs" "$WORK/backups" "$WORK/fixture"

STUB_MODE_FILE="$WORK/fixture/mode"
echo "ok" > "$STUB_MODE_FILE"

cat > "$WORK/stubs/pg_dump" <<'STUB'
#!/usr/bin/env bash
case "$(cat "$STUB_MODE_FILE")" in
  fail) echo "pg_dump: connection refused" >&2; exit 1 ;;
  empty) exit 0 ;;
  *) printf 'pg_dump-custom-format-placeholder-bytes'; exit 0 ;;
esac
STUB

cat > "$WORK/stubs/age" <<'STUB'
#!/usr/bin/env bash
output=""
input=""
while [ $# -gt 0 ]; do
  case "$1" in
    --output) output="$2"; shift 2 ;;
    --recipient) shift 2 ;;
    --decrypt) cat "$2"; exit 0 ;;
    *) input="$1"; shift ;;
  esac
done
{ printf 'age-encryption.org/v1\n'; cat "$input"; } > "$output"
exit 0
STUB

chmod +x "$WORK/stubs/pg_dump" "$WORK/stubs/age"

export PATH="$WORK/stubs:$PATH"
export STUB_MODE_FILE
export DATABASE_URL="postgresql://stub/stub"
export AGE_RECIPIENT="age1stub"
export BACKUP_DIR="$WORK/backups"

pass=0; fail=0
ok()   { pass=$((pass+1)); printf 'ok   - %s\n' "$1"; }
bad()  { fail=$((fail+1)); printf 'FAIL - %s\n' "$1" >&2; }

run_script() {
  bash "$HERE/backup-db.sh" >"$WORK/out.log" 2>&1
}

# ---------- A: the dump tool dies ----------
echo fail > "$STUB_MODE_FILE"
printf 'keeper' > "$WORK/backups/bookle-2000-01-01-000000.dump.age"   # a good older backup
echo ""                               | run_script; rc=$?
count=$(find "$WORK/backups" -name 'bookle-*.dump.age' | wc -l)
if [ "$rc" -ne 0 ] && [ "$count" -eq 1 ] && [ -f "$WORK/backups/bookle-2000-01-01-000000.dump.age" ]; then
  ok "A dead pg_dump fails the script and leaves existing backups untouched"
else
  bad "A dead pg_dump left rc=$rc with $count archives"
fi

# ---------- C: the dump is empty ----------
echo empty > "$STUB_MODE_FILE"
echo ""                               | run_script; rc=$?
count=$(find "$WORK/backups" -name 'bookle-*.dump.age' | wc -l)
if [ "$rc" -ne 0 ] && [ "$count" -eq 1 ]; then
  ok "an empty dump fails the script and writes nothing"
else
  bad "an empty dump left rc=$rc with $count archives"
fi

# ---------- B: the happy path ----------
rm -f "$WORK/backups"/bookle-*
echo ok > "$STUB_MODE_FILE"
echo ""                               | run_script; rc=$?
count=$(find "$WORK/backups" -name 'bookle-*.dump.age' | wc -l)
if [ "$rc" -eq 0 ] && [ "$count" -eq 1 ] && [ "$(wc -c < "$WORK"/backups/bookle-*)" -gt 0 ]; then
  ok "a working dump writes exactly one non-empty archive"
else
  bad "the happy path left rc=$rc with $count archives"
fi

# ---------- D: prune only the 8th-oldest, only after success ----------
rm -f "$WORK/backups"/bookle-*
for i in 01 02 03 04 05 06 07; do
  printf 'old-%s' "$i" > "$WORK/backups/bookle-2020-01-0$i-000000.dump.age"
done
echo ok > "$STUB_MODE_FILE"
echo ""                               | run_script; rc=$?
remaining=$(find "$WORK/backups" -name 'bookle-*.dump.age' | wc -l)
if [ "$rc" -eq 0 ] && [ "$remaining" -eq 7 ]; then
  ok "retention keeps the 7 newest after a successful backup"
else
  bad "retention left $remaining archives (want 7)"
fi
echo fail > "$STUB_MODE_FILE"
echo ""                               | run_script; rc=$?
remaining=$(find "$WORK/backups" -name 'bookle-*.dump.age' | wc -l)
if [ "$rc" -ne 0 ] && [ "$remaining" -eq 7 ]; then
  ok "a failed run prunes nothing"
else
  bad "a failed run pruned (remaining: $remaining)"
fi

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
