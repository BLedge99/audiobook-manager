#!/usr/bin/env bash
# Run the Playwright E2E suite against the docker-compose stack from inside WSL,
# where Docker is available.
#
#   scripts/e2e-wsl.sh                 # both projects
#   scripts/e2e-wsl.sh --project=security
#   scripts/e2e-wsl.sh e2e/smoke.spec.ts
#
# Everything the Makefile can do is delegated to make. The one thing this does
# itself is ensure a Linux Node exists -- see scripts/e2e-wsl-setup.sh -- because
# WSL ships none, and the Windows interop `npm` installs .cmd wrappers into
# node_modules/.bin that bash cannot execute.
#
# The whole sequence stays in ONE shell session: WSL terminates the distribution
# when it goes idle, which SIGTERMs the containers and produces "server not
# reachable" failures that have nothing to do with the code. `make test-e2e`
# keeps compose-up, the health wait and the test run in a single recipe for the
# same reason.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$HERE/e2e-wsl-setup.sh" || exit 1

REPO="/mnt/c/Users/benle/Documents/Projects/TechNative/audiobook-manager"
cd "$REPO" || exit 1

if ! command -v make >/dev/null 2>&1; then
  echo "GNU make is not installed in WSL. Install it with: sudo apt-get install -y make"
  exit 1
fi

# `make test-e2e ARGS="..."` forwards Playwright arguments.
exec make test-e2e ARGS="$*"