# ADR 031 — Remote media in the Android shell is served through a native `_media` proxy

## Status

Accepted 2026-11-12. Extends ADR 021 and supersedes the media-path assumption
of ADR 014 (the origin-stability decision itself stands). Spec:
[`specs/26-android-app.md`](../specs/26-android-app.md) (remote-streaming
criteria). Plan: [`docs/android-remote-playback-media-proxy-plan.md`](../docs/android-remote-playback-media-proxy-plan.md).

## Context

Streaming (not downloaded) books from the local instance — plain HTTP on the
household LAN — failed in the Android app against every book, reproducibly, on
a Pixel 4a. The web client worked fine against the same instance, and the
Android app worked fine against the https production instance. The on-device
console (`adb logcat`, 2026-11-12) settled the mechanism:

- every API `fetch()` logged a *warning* ("This content should also be served
  over HTTPS") and succeeded — the WebView's `allowMixedContent` mode covers
  active mixed content;
- the media element logged an *error* — `Mixed Content: … requested an
  insecure audio file 'http://<lan-ip>:<port>/api/tracks/1/stream?media=…'.
  **This request has been blocked; the content must be served over HTTPS.**`
  — and fired its `error` event immediately. Chrome auto-upgrades passive
  mixed content (audio/video/img) http→https; the household LAN server has no
  TLS, so the upgrade fails and the element dies. The UI symptom was "spinner
  starts and immediately stops".

ADR 014's `allowMixedContent` fix therefore only ever fixed API calls; the
storage-preserving configuration was never device-tested for media loads.

Two compounding defects were found behind this:

1. The media element was fed an absolute plain-HTTP URL directly
   (`usePlayerSource` → `mediaAssetUrl` → `<audio src>`).
2. `mediaAssetUrl` never sent the `x-profile-id` header. `/api/auth/media-token`
   scopes the token to the active profile resolved from that header, so every
   mint answered **400 `profile_required`** — on *every* platform, including
   https production. Production never noticed, because plain stream URLs work
   there; the 5-minute scoped media tokens had never actually minted anywhere.

## Decision

Serve all native-shell media from the app's own origin, fulfilled by native
code — never an absolute http(s) URL on a media element:

```
<audio src="https://localhost/_media?url=<encodeURIComponent(target)>">
      │ same-origin load — no mixed content, no CORS, no cookies
      ▼
MediaProxyWebViewClient.shouldInterceptRequest   (Java, extends BridgeWebViewClient)
      │ validates the target (scheme http/https; path must match
      │   ^/api/(audiobooks/\d+/(stream|cover)|tracks/\d+/stream)$,
      │   no userinfo, IPv4/DNS host, no fragment)
      │ forwards only Range + Accept; adds nothing (no Cookie, no Origin)
      ▼
Server stream endpoint  →  WebResourceResponse passthrough
      200/206/4xx/416 · Content-Type from server · Content-Length
      · Content-Range · Accept-Ranges · cache headers
```

Rules:

- **Allowlist, not open proxy.** Only the media surface is relayed:
  `/api/audiobooks/<id>/stream`, `/api/audiobooks/<id>/cover`,
  `/api/tracks/<id>/stream`. Anything else is answered 400 and never touches
  the network. IPv6-literal LAN hosts are rejected (plain DNS/IPv4 only).
- **Content-Type and Range pass through.** Seek support is the whole reason
  the server speaks 206/416; the proxy must not buffer or re-chunk.
- **No query string is ever logged.** Targets may carry a 5-minute media
  token; the interceptor logs the path only, on failure.
- **Failure is a deterministic 400/502 response**, never `null` (which would
  push the WebView onto the primary network with a URL it cannot load). The
  `<audio>` element fires its error event, and the player's existing retry
  ladder (fresh scoped token, one forced reload, then position-preserving
  failure) applies unchanged.
- **The client rewrites URLs in exactly one place.** `resolveRemote` in
  `usePlayerSource.ts` wraps the resolved URL (and the plain fallback used
  when the mint fails) in the proxy prefix in the native shell only. The web
  build is unchanged. Downloaded books (`capacitor-file://` via
  `localUrlForTrack`) bypass the proxy entirely. `coverUrl()` in the shell is
  wrapped the same way, so a fresh install renders images over plain http —
  the persistent IndexedDB cover cache had been masking first-load breakage.
- **`mediaAssetUrl` now sends the active-profile header** (`x-profile-id`,
  household experience only) alongside the session header, so scoped media
  tokens actually mint. This also fixes the token path on https production,
  which previously fell back to plain URLs everywhere.

`allowMixedContent`, `server.cleartext` and `network_security_config.xml` all
stay: API calls still need the first, Android's network layer still needs the
other two. The trade recorded in ADR 014 (LAN-only, trusted network) is
unchanged, not extended.

## Consequences

- Remote streaming works on a plain-HTTP LAN instance — verified on a Pixel 4a
  over Wi-Fi, 2026-11-12: streamed M4B, chapter seek, chapter advance,
  per-track books, lock-screen controls, downloaded-book fallback, production
  https instance, fresh-profile covers.
- Production (https) media now flows through the same proxy in the shell —
  uniform code path; the proxy handles absolute https targets identically.
- The 5-minute media-token lifetime is unchanged: after expiry, the element's
  next Range request 401s, the player's error ladder mints a fresh token and
  performs one forced reload at the stored position.
- Media tokens are minted on the shaded path (the `<audio>` element issues
  its own requests; the token is bound to profile + resource). The allowlist
  means a leaked token authorises only its one media item for five minutes —
  the same blast radius as before.
- Two hosts with different content types share one proxy (`audio/mpeg`
  streams, `image/*` covers); `Content-Type` passes through verbatim.
- Java logic is split into a pure, JUnit-tested `MediaProxy` class
  (`MediaProxyTest`, 30 cases) from the Android-bound
  `MediaProxyWebViewClient`; the client URL shape is pinned in
  `client/src/lib/mediaProxy.test.ts`, `usePlayerSource.test.tsx` (native
  cases) and `e2e/native-media-proxy.spec.ts` (stubbed-shell browser run).

## Alternatives considered

- **Local HTTPS with an internal CA** (`tls internal` / mkcert): correct and
  still the long-term destination, but it needs a CA installed on every phone
  and a certificate whose SANs track the DHCP-assigned LAN address; ADR 021
  documents why the household keeps plain HTTP. Rejected for now.
- **`androidScheme: "http"`** (serve the WebView over http): removes mixed
  content entirely, but changes the storage origin and orphaned localStorage and
  IndexedDB (the 2026-10 incident). Rejected — the same reason as ADR 014.
- **MSE/`fetch` progressive playback**: JS-only, but the WebView's SourceBuffer
  codec coverage, seek semantics and buffer management would have to be
  rebuilt for every audiobook format, and the app already depends on the
  element's Range-request behaviour. Rejected as strictly more fragile.
- **Open proxy** (relay any LAN URL): would have been less code, but an
  allowlist of the three endpoints the app calls costs one regex and removes
  the proxy as a lateral-movement tool. Rejected.
- **Fix nothing; force users to USB tunnelling or https**: rejected — the
  household deployment *is* "the phone reaches the home server by IP", and it
  is the owner's primary path.
