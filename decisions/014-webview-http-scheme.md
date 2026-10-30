# ADR 014 — Keep the WebView origin stable while reaching LAN servers

## Status

Accepted. This supersedes the earlier decision to serve the WebView over
`http://localhost`. The app must reach a plain-HTTP home server over Wi-Fi
without changing the origin that owns the device's localStorage and IndexedDB.

## Context

The app is a Capacitor WebView. Its whole purpose is to be a player for books on
a server somewhere on the household LAN, reachable by IP.

It could not do that. On a Pixel 4a with `com.google.android.webview`
154.0.8037.106, every request from the app to a LAN address failed
instantaneously:

| Request | Result |
|---|---|
| `http://localhost:3000` via `adb reverse` | `200`, 40ms |
| `http://192.168.1.203:3311`, same server, LAN IP | `TypeError: Failed to fetch`, 1ms |

The instinct was that this was a port, a firewall or a CORS problem. All three
were ruled out by measurement, deliberately:

- The phone pings the host: 0% loss, ~15ms.
- The host answers `200` on that exact port from `127.0.0.1`.
- The phone's **own OS stack** gets `HTTP/1.1 200 OK` from the LAN address over
  `nc`, bypassing the browser entirely.
- The CORS preflight returns `204` with `access-control-allow-origin:
  https://localhost` and `access-control-allow-credentials: true`.
- `network_security_config.xml` sets `cleartextTrafficPermitted="true"`, and
  `targetSdk` is 36.

So the network was fine, the port was fine, the firewall was fine, the server
was fine, and CORS was fine. A 1ms failure is not a network timeout; it is a
local decision made before any packet was sent.

The cause is **mixed content**. Capacitor serves the app from
`https://localhost` by default, which makes the page a *secure context*. Every
request the app then makes to the home server is plain `http://`, which is
mixed content, which the renderer blocks.

The reason it ever looked like it worked is that `http://localhost` is exempt.
The URL standard treats localhost as a *potentially trustworthy origin*, so
requests to it are not mixed content at all. The original device setup used
`adb reverse`, which routes the phone's own `localhost:3000` to the PC — and so
landed squarely inside that exemption. The app worked, for a reason that had
nothing to do with how a normal user would reach their own server.

This is why the user remembered it working before: it did, but only over USB.

## Decision

Keep Capacitor's default `https://localhost` origin. Set
`android.allowMixedContent: true` in `capacitor.config.ts` so the WebView may
make the app's plain-HTTP requests to the user-configured home server. Keep
`server.cleartext` and `network_security_config.xml` configured for Android's
network stack, and keep both `https://localhost` and `http://localhost` on the
server's CORS allow-list.

The mixed-content setting is a security trade-off. It is acceptable only for
the current local-first app, whose bundled UI calls the configured home server
over a trusted LAN. Use HTTPS for the server if the app is exposed beyond that
network.

The earlier `server.androidScheme: "http"` change did make a same-scheme LAN
request possible, but it also changed the browser origin. Both localStorage and
IndexedDB are origin-scoped; the old profile/server URL and downloaded-book
catalogue became invisible even though the audio files remained on disk. The
new configuration restores the original origin rather than asking listeners to
rebuild that data from scratch.

Both CORS origins remain allowed and are tested in `server/src/app.test.ts`.
This matters because a CORS rejection surfaces to `fetch()` as a bare
`TypeError: Failed to fetch`, which does not reveal the cause.

## A correction worth being explicit about

The first version of this ADR claimed the scheme change alone was the fix. That
was wrong, and it was wrong in the most misleading possible direction: it
explained the symptom convincingly, was consistent with every measurement taken,
and would have shipped as "done" while the app remained completely unusable over
Wi-Fi. The measurements were sound; the inference from them was not.

The lesson recorded for whoever hits this next: the original evidence could not
distinguish between the two causes. A 1ms failure with a healthy network below
it is consistent with *both* a renderer policy decision and a CORS rejection,
and the fix that explains the symptom is not necessarily the fix that works.

## Alternatives rejected

**Send `Access-Control-Allow-Private-Network: true`.** This addresses Chrome's
Private Network Access preflight, which is a plausible-sounding explanation and
was checked. It is not the mechanism here: PNA governs a *secure* page reaching
a *private* address and would fail after a preflight round trip, not in 1ms, and
`localhost` is already exempt from PNA's origin check. Adding the header would
have been a plausible patch that fixed nothing.

**Only allow cleartext at the Android network layer.** This does not change the
WebView's mixed-content policy, so the renderer still blocks the request.

**Keep the `http://localhost` origin.** This fixed the renderer block but
separated existing localStorage and IndexedDB data from the new origin. It is
not the default because offline downloads and profile state must survive app
updates.

**Terminate TLS on the server.** The genuinely correct fix for a real deployment,
and rejected here only because the household would have to trust a self-signed
certificate on every phone, which converts a working product into a support
burden. Recorded as the destination if the app ever leaves a trusted LAN.

## Consequences

- **The app keeps its existing `https://localhost` origin.** localStorage and
  IndexedDB remain available, including the downloaded-book catalogue.
- The WebView allows mixed content. Treat this as a constrained LAN-only
  deployment; do not rely on it for untrusted network access.
- The interim `http://localhost` build has a separate origin. Data written by
  that build is not migrated automatically and remains available only when
  running a build that uses that origin.
- This setting does not bypass Wi-Fi client isolation. The phone and server
  must be able to reach one another on the selected network.

## Verification

The earlier HTTP-origin build was verified on a Motorola Defy. This
storage-preserving configuration still requires a physical-device check with
`adb reverse` disabled. The handoff records client isolation on the Cisco AP as
a separate, known network blocker; verify on a network that permits
device-to-device traffic before attributing a failed request to the app.