#!/usr/bin/env bash
# Trigger a scan against the running stack and wait for it to finish.
set -uo pipefail

REPO="/mnt/c/Users/benle/Documents/Projects/TechNative/audiobook-manager"
cd "$REPO" || exit 1

JAR=$(mktemp)
echo "=== login ==="
curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"password":"household"}' -c "$JAR" >/dev/null

echo "=== scan ==="
curl -s -X POST http://localhost:3000/api/scan \
  -H 'content-type: application/json' -d '{}' -b "$JAR"
echo

echo "=== waiting for scan ==="
for i in $(seq 1 120); do
  status=$(curl -s http://localhost:3000/api/scan/status -b "$JAR" | tr ',' '\n' | grep -o '"status":"[a-z]*"' | head -1 | cut -d'"' -f4)
  if [ "$status" = "complete" ] || [ "$status" = "error" ] || [ "$status" = "idle" ]; then
    echo "scan status: $status after ${i}s"
    break
  fi
  sleep 1
done

rm -f "$JAR"