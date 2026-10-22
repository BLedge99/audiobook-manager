.PHONY: start stop restart logs scan enrich migrate reset install install-server install-client client server test test-server test-client check-copy test-e2e capture device-tunnel verify lan

## Expose the server on the LAN so a phone can reach it.
# The whole stack runs inside WSL, and WSL's NAT mode only relays the server to
# Windows on loopback -- so http://<lan-ip>:3000 is refused and an Android phone
# can download nothing. This adds a port proxy from the LAN address to the WSL
# guest address, plus the firewall rule, then probes the result.
#
# It is a script rather than a pasted command because the WSL guest IP changes on
# every WSL restart, so a hand-typed rule silently points at a dead address
# later. Re-run this after restarting WSL.
#
# Needs Administrator; the script re-launches itself elevated, so expect one UAC
# prompt. `make restart` does not call it -- run `make lan` explicitly.
lan:
	@script="./scripts/expose-lan.ps1"; \
	if command -v wslpath >/dev/null 2>&1 && grep -qi microsoft /proc/version 2>/dev/null; then \
		script=$$(wslpath -w "$$script"); \
	fi; \
	powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$$script"

start:
	docker compose up -d

stop:
	docker compose down

## Recreate the containers.
# `docker compose up -d` reuses an existing container, and although the source
# directory is bind-mounted and tsx watch should reload, a stale process is a
# confusing way to lose an afternoon. Use this after changing server code.
restart:
	docker compose up -d --force-recreate

logs:
	docker compose logs -f

## Trigger a library scan.
# Two things this had to get right:
#
#  - It authenticates. APP_PASSWORD defaults to "household" in compose, so an
#    unauthenticated POST returns 401.
#  - It checks HTTP status codes rather than grepping bodies. The old version
#    used `curl -s`, which prints nothing and still exits 0 on a 401 -- so
#    `make scan` failed silently, which is very likely why the library kept
#    stale titles long after the album-tag fix landed.
#
# If the server has no password, the unauthenticated POST just succeeds and
# the login step is skipped.
scan:
	@echo "Triggering library scan..."
	@rm -f /tmp/ab-scan-cookies /tmp/ab-scan-body
	@pw="$${APP_PASSWORD:-household}"; \
	code=$$(curl -s -o /tmp/ab-scan-body -w '%{http_code}' \
		-X POST http://localhost:3000/api/scan -H 'content-type: application/json' -d '{}'); \
	if [ "$$code" = "401" ]; then \
		curl -s -o /dev/null -X POST http://localhost:3000/api/auth/login \
			-H 'content-type: application/json' \
			-d "{\"password\":\"$$pw\"}" -c /tmp/ab-scan-cookies; \
		code=$$(curl -s -o /tmp/ab-scan-body -w '%{http_code}' \
			-X POST http://localhost:3000/api/scan -H 'content-type: application/json' \
			-d '{}' -b /tmp/ab-scan-cookies); \
	fi; \
	if [ "$$code" != "200" ] && [ "$$code" != "202" ]; then \
		echo "Scan request failed (HTTP $$code). Is the server running? Try: make start"; \
		cat /tmp/ab-scan-body 2>/dev/null; echo; \
		rm -f /tmp/ab-scan-body /tmp/ab-scan-cookies; exit 1; \
	fi; \
	cat /tmp/ab-scan-body; echo; \
	echo "Waiting for the scan to finish..."; \
	result=timeout; \
	for i in $$(seq 1 180); do \
		st=$$(curl -s http://localhost:3000/api/scan/status -b /tmp/ab-scan-cookies \
			| tr ',' '\n' | grep -o '"status":"[a-z]*"' | head -1 | cut -d'"' -f4); \
		if [ "$$st" = "complete" ] || [ "$$st" = "error" ]; then \
			echo "scan status: $$st after $${i}s"; result=$$st; break; \
		fi; \
		sleep 1; \
	done; \
	rm -f /tmp/ab-scan-body /tmp/ab-scan-cookies; \
	if [ "$$result" != "complete" ]; then echo "scan did not complete ($$result)"; exit 1; fi

## Re-run metadata enrichment over the whole library.
# `force` is what makes this useful: without it the run skips everything already
# marked `applied`, so re-running after a provider fix would change nothing.
# Chapter titles in particular are only re-fetched on a forced pass, because the
# scan resets each Track.title back to the embedded tag on every run.
enrich:
	@echo "Forcing enrichment pass over the library..."
	@rm -f /tmp/ab-enrich-cookies /tmp/ab-enrich-body
	@pw="$${APP_PASSWORD:-household}"; \
	code=$$(curl -s -o /tmp/ab-enrich-body -w '%{http_code}' \
		-X POST http://localhost:3000/api/enrichment/run -H 'content-type: application/json' -d '{"force":true}'); \
	if [ "$$code" = "401" ]; then \
		curl -s -o /dev/null -X POST http://localhost:3000/api/auth/login \
			-H 'content-type: application/json' \
			-d "{\"password\":\"$$pw\"}" -c /tmp/ab-enrich-cookies; \
		code=$$(curl -s -o /tmp/ab-enrich-body -w '%{http_code}' \
			-X POST http://localhost:3000/api/enrichment/run -H 'content-type: application/json' \
			-d '{"force":true}' -b /tmp/ab-enrich-cookies); \
	fi; \
	if [ "$$code" != "200" ] && [ "$$code" != "202" ]; then \
		echo "Enrichment request failed (HTTP $$code). Is the server running? Try: make start"; \
		cat /tmp/ab-enrich-body 2>/dev/null; echo; \
		rm -f /tmp/ab-enrich-body /tmp/ab-enrich-cookies; exit 1; \
	fi; \
	cat /tmp/ab-enrich-body; echo; \
	echo "Waiting for the run to finish..."; \
	result=timeout; \
	for i in $$(seq 1 300); do \
		st=$$(curl -s http://localhost:3000/api/enrichment/status -b /tmp/ab-enrich-cookies \
			| tr ',' '\n' | grep -o '"status":"[a-z]*"' | head -1 | cut -d'"' -f4); \
		if [ "$$st" = "complete" ] || [ "$$st" = "error" ]; then \
			curl -s http://localhost:3000/api/enrichment/status -b /tmp/ab-enrich-cookies; echo; \
			result=$$st; break; \
		fi; \
		sleep 1; \
	done; \
	rm -f /tmp/ab-enrich-body /tmp/ab-enrich-cookies; \
	if [ "$$result" != "complete" ]; then echo "enrichment did not complete ($$result)"; exit 1; fi

migrate:
	docker compose run --rm server npm run migrate

reset:
	docker compose down -v --remove-orphans
	docker compose up -d --build

install-server:
	cd server && npm install

install-client:
	cd client && npm install

install: install-server install-client

client:
	cd client && npm run dev

server:
	cd server && npm run dev

test: test-server test-client

test-server:
	cd server && npm test

test-client:
	cd client && npm test

## Check the interface copy against the ui-copy rules (spec 15b feature 7).
# The catalog check is the gate: a banned word in a listener-facing string
# fails. The source scan is advisory until feature 7's rewrite pulls the
# remaining inline literals into the catalog (then add `--fail-on-scan`).
#
# `scripts/copy.config.json` records the product's own banned words and, in
# `ignoreKeys`, the keys that still contain them. That list is the burn-down
# worklist, and it should only ever shrink -- never add a key to silence a
# new string.
#
# Deliberately NOT part of `make test` yet: the worklist is still open. It
# joins `make test`, and CI, when the list is empty.
check-copy:
	cd client && npm run check:copy

## Full E2E suite against the running stack.
# The compose-up, the health wait and the test run stay in ONE recipe on
# purpose: under WSL the distribution terminates when idle, which SIGTERMs the
# containers and produces "server not reachable" failures that have nothing to
# do with the code. If Docker is inside WSL, use `scripts/e2e-wsl.sh`, which
# also provisions a Linux Node.
test-e2e:
	docker compose up -d
	@for i in $$(seq 1 90); do \
		curl -sf http://localhost:3000/api/health > /dev/null 2>&1 && { echo "server healthy after $${i}s"; break; }; \
		sleep 1; \
	done
	@for i in $$(seq 1 90); do \
		curl -sf http://localhost:5173/ > /dev/null 2>&1 && { echo "client reachable after $${i}s"; break; }; \
		sleep 1; \
	done
	npx playwright test $(ARGS)

## Point the phone at the server over USB.
# The phone can end up on a WiFi segment that cannot reach the home LAN, and
# then every request fails with "failed to connect to server" while the server
# is running perfectly. `adb reverse` tunnels over the USB cable and needs no
# network at all.
#
# The tunnel lives on the adb connection, so it goes when the cable is
# unplugged or the phone reboots -- and nothing on the phone says so. This is
# the command that brings it back.
device-tunnel:
	powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts/device-tunnel.ps1"

## Design-review screenshots against the running stack.
# The same one-recipe rule as `test-e2e`: the compose-up, the health wait and
# the capture stay in ONE session, because WSL terminates the distribution when
# idle and SIGTERMs the containers.
#
# If Docker is inside WSL, use `scripts/capture-ui-wsl.sh` instead: the capture
# has to reach the client's published port, and from Windows that needs a
# portproxy whose target address rots every time WSL restarts.
capture:
	docker compose up -d
	@for i in $$(seq 1 90); do \
		curl -sf http://localhost:3000/api/health > /dev/null 2>&1 && { echo "server healthy after $${i}s"; break; }; \
		sleep 1; \
	done
	@for i in $$(seq 1 90); do \
		curl -sf http://localhost:5173/ > /dev/null 2>&1 && { echo "client reachable after $${i}s"; break; }; \
		sleep 1; \
	done
	node scripts/capture-ui.js

## Live enrichment check against a real library (default ./test).
# Scans, runs the real provider APIs and reports what changed. Read-only with
# respect to media: it writes to a scratch database and the covers dir only.
verify:
	cd server && npm run verify:enrichment