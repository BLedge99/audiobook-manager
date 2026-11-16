#!/bin/sh
# Spec 43 phase 4.3 — smoke check for the hosted demo (post-deploy / post-rollback).
# Read-only; safe against production. Exits 0 on success, 1 on any failed check.
#
# Usage:
#   DEMO_URL=https://audiobook-manager.onrender.com ./scripts/smoke-demo.sh
#   DEMO_URL=http://localhost:3000 ./scripts/smoke-demo.sh   # against a local build
#
# Optional (enables the authenticated check):
#   SMOKE_PROFILE_ID=123 SMOKE_PASSWORD=... ./scripts/smoke-demo.sh
#   SMOKE_SESSION=<x-house-session cookie/header value> ./scripts/smoke-demo.sh

set -eu

BASE="${DEMO_URL:-https://audiobook-manager.onrender.com}"
echo "[smoke] target: $BASE"
FAIL=0
check() { # name, expected, actual
  if [ "$2" = "$3" ]; then echo "  ok   $1"; else echo "  FAIL $1 (expected $2, got $3)"; FAIL=$((FAIL + 1)); fi
}
need_cmd() { command -v "$1" >/dev/null 2>&1 || { echo "[smoke] missing required command: $1" >&2; exit 1; }; }
need_cmd curl

# 1. Health endpoint.
code=$(curl -s -o /tmp/smoke-health.json -w '%{http_code}' "$BASE/api/health")
check 'GET /api/health answers 200' 200 "$code"
if grep -q '"status"' /tmp/smoke-health.json; then echo '  ok   health body carries status'; else echo '  FAIL health body'; FAIL=$((FAIL + 1)); fi

# 2. Family API is not anonymously readable.
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/audiobooks")
case "$code" in 401|403) echo '  ok   GET /api/audiobooks rejects anonymous';; *) echo "  FAIL GET /api/audiobooks anonymous -> $code (expected 401/403)"; FAIL=$((FAIL + 1));; esac

# 3. App shell serves.
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/")
check 'GET / serves the shell (200)' 200 "$code"

# 4. Security headers are present (they are app-level, not edge-level).
headers=$(curl -s -D - -o /dev/null "$BASE/")
for header in content-security-policy strict-transport-security x-content-type-options; do
  if printf '%s' "$headers" | grep -qi "^$header:"; then echo "  ok   header $header present"; else echo "  FAIL header $header missing"; FAIL=$((FAIL + 1)); fi
done
# 5. Admin surface: unauthenticated must not leak data (401/404, never 200 with a body).
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/admin/status")
case "$code" in 401|404) echo '  ok   /api/admin/status is not anonymously readable';; *) echo "  FAIL /api/admin/status -> $code"; FAIL=$((FAIL + 1));; esac

# 6. Optional authenticated round trip.
if [ -n "${SMOKE_SESSION:-}" ]; then
  code=$(curl -s -o /tmp/smoke-books.json -w '%{http_code}' -H "x-house-session: $SMOKE_SESSION" "$BASE/api/audiobooks")
  check 'authenticated GET /api/audiobooks' 200 "$code"
  if grep -q '"id"' /tmp/smoke-books.json; then echo '  ok   books payload parses (has book ids)'; else echo '  FAIL books payload shape'; FAIL=$((FAIL + 1)); fi
elif [ -n "${SMOKE_PROFILE_ID:-}" ] && [ -n "${SMOKE_PASSWORD:-}" ]; then
  code=$(curl -s -o /tmp/smoke-login.json -w '%{http_code}' -X POST "$BASE/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"profileId\":${SMOKE_PROFILE_ID},\"password\":\"$SMOKE_PASSWORD\"}")
  check 'login with SMOKE_PROFILE_ID' 200 "$code"
else
  echo '  note SMOKE_SESSION/SMOKE_PROFILE_ID not set — authenticated check skipped'
fi

if [ "$FAIL" -gt 0 ]; then echo "[smoke] $FAIL check(s) FAILED"; exit 1; fi
echo "[smoke] all checks passed"
