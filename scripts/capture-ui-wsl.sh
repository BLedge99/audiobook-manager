#!/usr/bin/env bash
# Run the design-review capture against the docker-compose stack from inside
# WSL, where Docker is available.
#
#   scripts/capture-ui-wsl.sh
#
# The same reasoning as `e2e-wsl.sh`: the whole stack runs inside WSL, and
# the capture has to reach the client's published port. Running it on Windows
# instead needs a portproxy from Windows to the WSL guest address -- and that
# proxy rots whenever WSL restarts and changes its address, which is the
# failure this avoids.
#
# It also has to share ONE session with the compose-up, for the same reason
# `test-e2e` does: WSL terminates the distribution when it goes idle, which
# SIGTERMs the containers. `make capture` does the compose-up, the health
# wait and the capture together, so they cannot be split apart.
#
# Everything here is repo-relative, so it works on any machine with the
# repository checked out.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$HERE/e2e-wsl-setup.sh" || exit 1

REPO="$(cd "$HERE/.." && pwd)"
cd "$REPO" || exit 1

exec make capture
