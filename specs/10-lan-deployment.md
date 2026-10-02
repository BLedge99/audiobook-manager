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

## Acceptance criteria

- [ ] Fresh `docker compose up` serves the whole app from one URL.
- [ ] Server auto-restarts after reboot and `docker compose restart`.
- [ ] Media volume is mounted read-only; scans work; nothing mutates media.
- [ ] README documents hardware move and hostname/IP setup.

## Testing

- E2E smoke against the composed stack; reboot test documented manually.

## Not in this spec

- HTTPS, internet exposure (decisions/006).
