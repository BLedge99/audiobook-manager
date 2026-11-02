# Spec 10 — LAN Deployment

## Purpose

Run reliably at home, reachable from phones/laptops, surviving reboots, with a
documented path from dev PC to Raspberry Pi.

## Behaviour

- docker-compose services for server + client (client built and served, or the
  server serves the built client — one origin simplifies CORS/auth cookie).
- Server binds 0.0.0.0 on the LAN; client served on a stable port; documented
  access URL (`http://<server-ip>:3000` or a local hostname).
- Volume mounts for the database, covers dir, and media libraries (read-only
  mount for media by default).
- systemd unit or docker `--restart unless-stopped` for boot survival.
- Ready checklist for moving to Raspberry Pi: same compose file, arm64 images,
  smaller FFmpeg build.

## Bringing the local stack up for phones (`make local`)

Because Docker runs inside WSL and WSL's NAT only relays loopback, the server
is not reachable at the host's LAN IP until Windows relays it
(`scripts/expose-lan.ps1`: netsh portproxy + scoped firewall rule + probe).

`make local` is the normal bring-up: `start` (container up), a health-wait, then
the exposure step. One UAC prompt; the script re-resolves the WSL guest IP on
every run, so it must be re-run after restarting WSL or Docker.

Devices then use `http://<lan-ip>:3000` as the server address in the app
(plain HTTP on the home network — see decisions/021 for the HTTPS decision).

If a phone still cannot connect while the script's probe passes:

- **Check for a VPN app on the phone first** (Settings → VPN). An always-on VPN
  black-holes the LAN traffic it does not proxy; the app's server check hangs
  in "checking" instead of reporting refused, and pings from the phone die in
  one direction only (decisions/021, LIMITATIONS §1.6).
- Windows answers no pings by default (inbound ICMP echo is blocked), so a
  failed phone→PC ping is not evidence of a network problem by itself.

## Acceptance criteria

- [x] Fresh `docker compose up` serves the whole app from one URL.
- [x] Server auto-restarts after reboot and `docker compose restart`.
- [x] Media volume is mounted read-only; scans work; nothing mutates media.
- [x] README documents hardware move and hostname/IP setup.
- [x] `make local` brings the stack up healthy and publishes the server at
      `http://<lan-ip>:3000` (one UAC prompt), with a reachability probe.

## Testing

- E2E smoke against the composed stack; reboot test documented manually.

## Not in this spec

- HTTPS, internet exposure (decisions/006, and decisions/021 for the plaintext
  LAN decision).
