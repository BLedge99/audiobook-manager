# ADR 006 — Local network only; remote access deferred

## Status
Accepted

## Context
The household is non-technical. Tailscale adds per-device setup burden; public
hosting adds auth/TLS risk. For now, local-network access is enough.

## Decision
- The app serves only over the home LAN (spec 10).
- No tunnel, no port forwarding, no public exposure.
- When remote access is revisited, re-evaluate:
  - **Cloudflare Tunnel + household password:** easiest for non-technical users
    (normal URL, no VPN client); needs a domain or managed hostname.
  - **Tailscale:** strongest default, private mesh; every device needs the app.
- Both require the household-password gate (spec 03) to be in place first.

## Alternatives considered
- **Tailscale now:** judged too much operational friction for current users.
- **Public hosting with auth now:** security burden before auth/maturity exists.

## Consequences
- Remote playback is unavailable until revisited; LAN assumption documented in
  PRD and spec 10.
