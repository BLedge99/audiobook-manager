#!/usr/bin/env bash
# Hold a WSL client session open so the distro -- and therefore Docker, and
# therefore the whole audiobook stack -- stays up between terminal sessions.
#
# WSL powers a distribution off 15 seconds after its last client session ends
# (`instanceIdleTimeout`, default 15000 in %USERPROFILE%\.wslconfig). Docker
# runs *inside* this distribution as a systemd service, so the distribution
# powering off stops docker.service, which SIGTERMs every container. The
# containers then exit 143 and it reads as "the server crashed". The server
# never crashed.
#
# A distribution with a live client session is never idle, so it never powers
# off. This script is that session: it runs under `wsl.exe --exec`, which keeps
# a client attached for as long as the script runs.
#
# The sentinel file is what makes releasing it clean. Removing the sentinel
# ends the loop, which ends the script, which closes the session -- so the
# distro can then idle out and power off normally. No orphaned `wsl.exe`, no
# orphaned `sleep`, and the stop path needs no kill -9.
#
# The Windows-side orchestrator is scripts/wsl-lifecycle.ps1. Nothing here
# touches the product: no container, image, volume or port is affected.

set -u

sentinel=/tmp/audiobook-manager-keepalive

# Clear any sentinel left behind by a session that died without running its
# EXIT trap, so a stale one cannot make this session exit immediately.
rm -f "$sentinel"
touch "$sentinel"

cleanup() {
  rm -f "$sentinel"
}
trap cleanup EXIT INT TERM

# A short interval so a release is noticed quickly rather than after a
# minute of the distro already being idle.
while [ -e "$sentinel" ]; do
  sleep 5
done
