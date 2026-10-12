#!/usr/bin/env bash
# Force-recreate the containers so the server picks up changed source.
# `docker compose up -d` reuses an existing container, and although the source
# directory is bind-mounted and `tsx watch` should reload, a stale process is a
# confusing way to spend an afternoon.
set -uo pipefail
cd /mnt/c/Users/benle/Documents/Projects/TechNative/audiobook-manager || exit 1

echo "=== recreating ==="
docker compose up -d --force-recreate 2>&1 | tail -5

echo "=== waiting for server ==="
for i in $(seq 1 120); do
  curl -sf http://localhost:3000/api/health >/dev/null 2>&1 && { echo "healthy after ${i}s"; break; }
  sleep 1
done

echo "=== scanner.ts reflects the host source? ==="
docker compose exec -T server sh -lc 'grep -c staleIds src/scanner.ts || echo 0' 2>&1 | tail -2