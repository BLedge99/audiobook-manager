# ADR 014 — The WebView serves the app over http, so the LAN server is reachable

## Status

Accepted. Fixes `LIMITATIONS.md` 1.6, which blocked the product's primary
deployment: a phone could not reach its own home server by LAN address.

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

Two changes, and the second one is the reason this ADR needed rewriting.

**1. Set `server.androidScheme: "http"` in `capacitor.config.ts`.**

The app is then served from `http://localhost`. The page is no longer a secure
context, so `http://192.168.x.x` is same-scheme rather than mixed content, and
the request is issued normally.

**2. Add `http://localhost` to the server's CORS allow-list** (`server/src/app.ts`).

The allow-list named `https://localhost` — correct for Capacitor's default
scheme, and therefore correct until change 1 landed. CORS compares the origin
*whole*, so moving to `http://localhost` silently removed the app from its own
allow-list.

This was not caught by reasoning, or by any unit test, or by the browser. It was
caught by installing the APK on a second phone and running the probe again,
where the LAN fetch **still** failed in 21ms.

The failure mode is unusually nasty and worth recording: the browser rejects the
request as CORS, but the renderer reports it to `fetch()` as a bare
`TypeError: Failed to fetch` with no mention of CORS in the message, the console
warning, or the promise. Nothing in the app points at the cause. The only way to
see it is to `curl` an `OPTIONS` preflight with `Origin: http://localhost` and
notice the absent `Access-Control-Allow-Origin` header — which is exactly what
had to be done here. Both schemes are now allowed and both are asserted in
`server/src/app.test.ts`, because the two settings are coupled and the coupling
is invisible.

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

**Add `android:usesCleartextTraffic="true"` to the manifest.** It is absent, and
it is tempting to add. It would not help: that attribute and
`networkSecurityConfig` both govern what the *network stack* may do, and the
network stack was never the problem. The renderer never issued the request.

**Terminate TLS on the server.** The genuinely correct fix for a real deployment,
and rejected here only because the household would have to trust a self-signed
certificate on every phone, which converts a working product into a support
burden. Recorded as the destination if the app ever leaves a trusted LAN.

## Consequences

- **The app reaches a home server by IP over Wi-Fi.** That is the product's
  stated deployment, and it now works without a cable.
- The app's own origin is not a secure context. It serves bundled local assets
  and nothing else. Every request it makes still goes to the address the user
  typed, over a LAN — the same trust boundary `network_security_config.xml`
  already documents, with the same reasoning. No new exposure is introduced,
  because the app was already making plain-HTTP requests to a user-typed host.
- **localStorage is a different origin.** `https://localhost` and
  `http://localhost` are different origins, so an existing install appears to be
  a fresh one: the server URL and the chosen profile are gone. The server-URL
  screen appears once and the listener re-enters the address. Expected, one time,
  and worth saying out loud rather than letting someone think their profile was
  deleted.
- Any future feature needing a secure context (WebCrypto, service workers over
  HTTPS, `getUserMedia`) would need this revisited. None is on the roadmap, and
  the PWA build is unaffected because it is served over real HTTPS.

## Verification

Verified on a **Motorola Defy, Android 11, WebView 155**, with **no USB cable
and no `adb reverse` tunnel** — the whole point being that a tunnel would mask
the failure it is supposed to detect:

| Check | Result |
|---|---|
| `adb reverse --list` | empty — nothing masking the network path |
| Phone → host over Wi-Fi | ping 0% loss, ~3.8ms |
| Origin in the WebView | `http://localhost` (was `https://localhost`) |
| `GET http://192.168.1.203:3000/api/health` from the app | `200`, 44ms |
| `GET /api/audiobooks` | `200`, 27ms |
| Screenshot | 12 real titles, real covers, favourites visible |

The Pixel 4a (WebView 154) has not been re-tested against this fix; the Defy is
a strictly newer WebView and passed, which is the harder case.