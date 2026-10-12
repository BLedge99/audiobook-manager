#!/usr/bin/env bash
# Run the Playwright E2E suite against the docker-compose stack from inside WSL,
# where Docker is available.
#
#   scripts/e2e-wsl.sh                 # both projects
#   scripts/e2e-wsl.sh --project=security
#   scripts/e2e-wsl.sh e2e/smoke.spec.ts
#
# Two WSL-specific notes, both learned the hard way:
#
# 1. The whole sequence runs in ONE shell session. WSL terminates the
#    distribution when it goes idle, which SIGTERMs the containers; running
#    `docker compose up` in one invocation and `playwright test` in another
#    produces "server not reachable" failures that have nothing to do with the
#    code.
#
# 2. WSL has no Linux Node of its own, so `npm` resolves to the Windows interop
#    binary, which writes .cmd/.ps1 wrappers into node_modules/.bin that bash
#    cannot execute. A Linux Node must therefore be on PATH -- see
#    `scripts/e2e-wsl-setup.sh`, which installs one and is idempotent.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/e2e-wsl-setup.sh" >/dev/null 2>&1 || true

REPO="/mnt/c/Users/benle/Documents/Projects/TechNative/audiobook-manager"
cd "$REPO" || exit 1

if ! command -v node >/dev/null 2>&1 || ! ls node_modules/.bin/playwright >/dev/null 2>&1; then
  echo "Prerequisites missing. Run: bash scripts/e2e-wsl-setup.sh"
  exit 1
fi

echo "=== compose up ==="
docker compose up -d 2>&1 | tail -5

echo "=== waiting for server ==="
for i in $(seq 1 90); do
  curl -sf http://localhost:3000/api/health >/dev/null 2>&1 && { echo "server healthy after ${i}s"; break; }
  sleep 1
done

echo "=== waiting for client ==="
for i in $(seq 1 90); do
  curl -sf http://localhost:5173/ >/dev/null 2>&1 && { echo "client reachable after ${i}s"; break; }
  sleep 1
done

echo "=== running E2E: $* ==="
npx playwright test "$@"
STATUS=$?
echo "=== exit: $STATUS ==="
exit $STATUS