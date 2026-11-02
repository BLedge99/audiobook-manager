# ADR 021 — LAN exposure via `make local`; the server stays plain HTTP on the home network

## Status

Accepted. Extends ADR 014's rejection of server-side TLS for this deployment
and records the bring-up workflow and the *actual* cause of the phones'
2026-10-21 "cannot reach the LAN" failure (decisions/014 briefly blamed AP
client isolation; that was wrong).

## Context

The household's primary setup is the local instance; the deployed instance
(audiobook-manager.onrender.com) exists for show, and web clients use its own
backend. Phones talk only to the local server over the LAN, at
`http://<lan-ip>:3000`.

Three facts shaped this decision:

- **Docker runs inside WSL, and WSL's NAT only relays loopback.** A container
  on :3000 is simply not reachable at the host's LAN IP until Windows is told
  to relay it. `scripts/expose-lan.ps1` already does that work (netsh
  portproxy + a scoped firewall rule + a reachability probe), but it must be
  invoked explicitly and the portproxy target -- the WSL guest IP -- rots on
  every WSL restart, so a one-off configuration silently stops working.
- **The earlier diagnosis recorded in the handoff was wrong.** "Both phones
  cannot reach the LAN at all (client isolation on the AP)" was a misreading.
  Root-caused 2026-11-02: the phones run an always-on VPN app that black-holes
  outbound traffic it does not proxy -- the phone could not even ping the
  *router* while the PC pinged the phone without issue, and Windows' own
  default inbound-ICMP block produced a convincing "phone→PC is dead" false
  positive that lent the isolation theory support. There is no Cisco hardware:
  the network is a Linksys toob fibre router, and the network itself was never
  the problem.
- **HTTPS on the LAN was evaluated and declined.** It would require every
  device to trust a self-signed or internal-CA certificate (in the Android
  app's case, `networkSecurityConfig` changes *and* a manual CA install per
  device), re-binding of the WebAuthn RP ID, and a second `https://` URL that
  users would have to remember to distinguish from the prod
  `https://audiobook-manager.onrender.com` origin. Against that, the gain is
  encryption of traffic on a household WiFi segment that is already encrypted
  at the link layer (WPA). ADR 014 rejected server-side TLS for exactly this
  support-burden reason and that reasoning still holds.

## Decision

- **`make local` is the normal bring-up**: `docker compose up -d`, wait for the
  server health endpoint, then run `scripts/expose-lan.ps1`. One UAC prompt;
  the script re-launches itself elevated, is idempotent, and re-resolves the
  WSL guest IP fresh each run. It must be re-run after restarting WSL or
  Docker, and it is safe to re-run at any time. `make start` itself gains no
  elevation prompt -- `make local` calls it.
- **The server stays plain HTTP on the home LAN.** Phones and the app are
  configured with `http://<lan-ip>:3000`. HTTPS is deferred until the local
  instance is ever exposed beyond a trusted network; this is a continuation of
  ADR 014, not a reversal of it.
- **`make device-tunnel` (`adb reverse`) remains the fallback** for networks
  that genuinely cannot route device-to-device. It is no longer the expected
  path on the home WiFi.
- **VPN apps on phones are a documented, known incompatibility.** An always-on
  VPN that drops the traffic it does not proxy produces the unmistakable
  signature the 2026-10-21 session chased: the app's server check hangs in
  "checking" and times out after minutes, with pings to every LAN address
  (including the router) lost in *one* direction only, while the reverse
  ping works. First diagnostic step on any "phone cannot connect" report is
  Settings → VPN on the offending device.

## Alternatives rejected

- **HTTPS everywhere on the LAN.** Per-device CA trust plus per-APK
  `networkSecurityConfig` changes registered as a support burden too heavy for
  the threat model of an encrypted household WiFi (ADR 014). Revisit only if
  the local instance ever leaves the premises.
- **Running the exposure inside `make start`.** Every dev start would pop a
  UAC prompt; `make local` elevates once per explicit run instead. If someone
  wants the exposure on every boot path, they can run `make local` rather than
  `make start`.
- **A static portproxy/configuration.** The WSL guest IP is reassigned on
  every restart; anything hand-pinned rots silently. The script re-resolves
  and confirms each run -- that is why it is a script rather than a documented
  command.
- **Router WAN port-forwarding for the local instance.** Contradicts
  ADR 006 (local network only) and buys nothing for the primary use case.

## Consequences

- Phones reach the server over plain HTTP at `http://<lan-ip>:3000`. CORS,
  auth and the WebAuthn configuration are unchanged from what already worked.
- Exposure outlives nothing: a WSL restart silently re-IPs and the portproxy
  dies again; re-run `make local`. This is documented in the Makefile recipe
  comment and is an accepted cost of the WSL checkpoint.
- `decisions/014`'s description of a "Cisco AP" client-isolation blocker is
  corrected to reflect the VPN root cause; its *technical* decision -- plain
  HTTP server, WebView origin stability -- is unchanged and unaffected.
- `LIMITATIONS.md` §1.6 carries the same correction.
