# Plan — Android remote playback over plain-HTTP LAN via a native WebView media proxy

**Date:** 2026-11-12 · **Status:** proposed (not started) · **Owner:** household

## Diagnosis evidence (Phase 0, completed 2026-11-12, Pixel 4a over WiFi)

Confirmed on the affected phone (VPN not a factor — reachability works; local
instance observed at `http://10.10.9.19:3001`):

- Every API `fetch()` logs a *warning*: `Mixed Content: … requested an insecure
  resource 'http://10.10.9.19:3001/api/auth/media-token'. This content should also
  be served over HTTPS.` — fetch still succeeds (covered by `allowMixedContent`).
- The media element logs an **error**, repeated per retry: `Mixed Content: The
  page at 'https://localhost/' was loaded over HTTPS, but requested an insecure
  audio file 'http://10.10.9.19:3001/api/tracks/1/stream?media=…'. **This request
  has been blocked; the content must be served over HTTPS.**`
- Root cause verified: Chrome auto-upgrades passive mixed content; the LAN server
  has no TLS → audio blocked. Not a reachability/VPN/server problem.

The mixed-content-media theory is confirmed; the plan proceeds as written.

## Problem

Streaming books from the local instance (`http://<lan-ip>:3000`) fails in the Android
app while the web client (both instances) and production (`https://audiobook-manager.onrender.com`)
work fine. On-device report: play button shows a spinner which starts and immediately
stops; **only playback fails** (login, library, settings all work over http); the
installed APK is built from current master (`allowMixedContent` + `cleartext` +
`network_security_config.xml` all in place); reproducible over WiFi.

## Root cause (working theory — confirmed on-device in Phase 0)

The WebView page origin is `https://localhost` (a secure context). The media element is
fed an absolute plain-HTTP stream URL built in `usePlayerSource.resolveRemote()` →
`mediaAssetUrl()` (token) → `<audio src="http://192.168.x.x:3000/api/…/stream?media=…">`.

Chrome auto-upgrades *passive* mixed content (audio/video/img) from http to https.
The local server has no TLS on :3000, so the upgraded request fails and the element
fires `error` immediately — the exact "spinner starts then stops" symptom. `fetch()` is
*active* mixed content, which **is** covered by `android.allowMixedContent = true`
(`MIXED_CONTENT_ALWAYS_ALLOW`), which is why the rest of the app works over http.

Supporting evidence:

- `client/capacitor.config.ts` — `allowMixedContent` was added for fetch, but no
  verification ever covered the media element (ADR 014: the storage-preserving
  configuration "still requires a physical-device check"; spec 26 / handoff.md:
  "This work has not been installed or tested on a phone").
- `LIMITATIONS.md` §1.4 / §1.6 — "Android LAN HTTP remains a transport gap"; covers
  render from the IndexedDB cover cache, which masks the image half of the problem.
- The production instance is https for the configured server URL, so no mixed content
  anywhere — consistent with it working perfectly.

## Fix direction (chosen by owner)

**Native WebView media proxy.** The `<audio>` element only ever loads from the app's own
origin, so mixed content never comes up:

```
<audio src="https://localhost/_media?url=<encodeURIComponent(http(s)://server/api/…/stream?media=TOKEN)>">
      │ same-origin load — no mixed content, no CORS, no cookies
      ▼
MediaProxyWebViewClient.shouldInterceptRequest   (Java, extends BridgeWebViewClient)
      │ parse + allowlist: scheme http/https; path must match
      │   ^/api/(audiobooks/\d+/(stream|cover)|tracks/\d+/stream)(\?|$)$
      │ open HttpURLConnection (10 s timeouts); forward ONLY Range + Accept;
      │ attach nothing (the media token rides in the URL; no cookies cross)
      ▼
Device stream endpoint (GET)  →  WebResourceResponse passthrough
      status 200/206/4xx/416 · Content-Type (audio/mpeg) · Content-Length
      · Content-Range · Accept-Ranges
```

Properties:

- Downloaded books are unchanged (`capacitor-file://` path untouched).
- Production (https) media also flows through the proxy in the shell — uniform code path.
- The web/PWA build never emits `_media` URLs — unchanged behaviour.
- 5-minute media tokens unchanged; the existing `onError` retry ladder (fresh token via
  `usePlayerSource.retry()`) covers mid-book token expiry across Range requests.
- No origin change → localStorage/IndexedDB preserved. `allowMixedContent`, `cleartext`
  and `network_security_config.xml` stay (fetch to http still needs them).
- No certificates, no per-device CA install, no server changes, no storage migration.
- Defense in depth: the allowlist means the proxy cannot be used to relay arbitrary LAN
  services; only the media endpoints the app already calls are reachable through it.
  No token is logged (log path only, never query).

## Phase 0 — Diagnosis (no code; aborts the plan if it contradicts)

1. On the affected phone over WiFi (VPN off, local instance selected): open a streamed
   book, reproduce, then chrome://inspect → device WebView logs.
2. Expect: `Mixed Content: The page at 'https://localhost/' was loaded over HTTPS, but
   requested an insecure element 'http://<lan-ip>:3000/api/…/stream…'. This request has
   been blocked; the content must be served over HTTPS.` (or `net::ERR_*` on the upgraded
   https URL). Record the exact line, WebView version, device/Android version.
3. Confirm cover behaviour on a cold cache (fresh profile): whether `<img>` to http also
   fails first-load (expected) — feeds Phase 6.
4. If the console instead shows connection refused/timeout/401, stop: the proxy does not
   fix reachability (ADR 021 territory); reassess before implementing.
5. Save this plan as `docs/android-remote-playback-media-proxy-plan.md` (this file) and
   commit it: `docs: plan for the Android remote-playback media proxy`.

## Phase 1 — Client routing (RED → GREEN)

Tests **first**, committed red? No: tests are written, run red, then implementation,
then commit green (repo convention: one reviewable commit per phase).

**RED — write/extend these tests, run them, confirm they fail:**

- new `client/src/lib/mediaProxy.test.ts`
  - `mediaProxyUrl("http://192.168.1.203:3000/api/audiobooks/5/stream?media=t")`
    → `https://localhost/_media?url=` + encodeURIComponent of the input
  - non-absolute or non-http(s) input returned unchanged (`capacitor-file:…`, `blob:`, relative `/api/…`)
  - decode round-trips; `?`/`&` inside inner URL encoded exactly once
- extend `client/src/lib/usePlayerSource.test.tsx` (native shell cases)
  - resolved stream URL for a track source startsWith `https://localhost/_media?url=`
    and decodes to `<server>/api/tracks/<id>/stream?media=…` (mediaAssetUrl mocked)
  - token failure path: plain fallback URL is **also** proxied (decode contains no `media=`)
  - web (non-shell): resolved URL unchanged — no `_media`

Confirm: `npx vitest run src/lib/mediaProxy.test.ts src/lib/usePlayerSource.test.tsx` → red.

**GREEN — implement:**

- new `client/src/lib/mediaProxy.ts` (`MEDIA_PROXY_PREFIX`, `mediaProxyUrl`)
- `client/src/lib/usePlayerSource.ts` → `resolveRemote()`: when `isNativeShell()`, wrap
  the final URL (token *or* plain fallback) in `mediaProxyUrl`. All playback sources flow
  through this one choke point (`bookSource`, `trackSource`), so both M4B and per-track
  books are covered.
- `mediaAssetUrl()` itself is **not** changed (downloads/FileTransfer need absolute URLs).

**Verify:** tests green; full client suite (`npm test`) + `tsc -b` clean.
**Commit 1:** `feat(client): stream native-shell media through the WebView _media proxy` → push.

## Phase 2 — Native interceptor (RED → GREEN, JUnit for the pure half)

**RED — write/extend, run, confirm red** (`gradle testDebugUnitTest` in `client/android`):

- new `MediaProxyTest.java` (JUnit 4, `testImplementation` already present)
  - `innerUrl()` accepts `https://localhost/_media?url=…` and returns the decoded target
  - rejects: non-`localhost` origin path, missing/empty `url` param, `ftp:`/`file:`/`content:`
    targets, targets with userinfo, targets whose path does not match the allowlist
    (`/api/admin`, `/api/audiobooks/abc/stream`, `…/streamx`, `../admin`), non-absolute targets
  - `forwardedRequestHeaders()` copies exactly `Range` and `Accept`, case-insensitively,
    and nothing else (Origin/Cookie/Referer/X-House-Session never forwarded)
  - `responseHeaders()` passes through exactly the whitelist
    (Content-Type, Content-Length, Content-Range, Accept-Ranges, Cache-Control, ETag)
  - `reasonPhrase()` maps 200/206/401/403/404/416/502

**GREEN — implement:**

- new `MediaProxy.java` — static, pure logic above (no Android types → plain JUnit).
- new `MediaProxyWebViewClient.java` — `extends BridgeWebViewClient`:
  - `shouldInterceptRequest`: if `MediaProxy.innerUrl(...) != null` → open `HttpURLConnection`
    (GET, 10 s connect/read timeouts), forward `Range`/`Accept`, execute; on ≥400 use
    `getErrorStream()`; return `WebResourceResponse(mimeType, null, status, reason,
    responseHeaders, inputStream)`.
  - any exception → deterministic `502 Bad Gateway` `WebResourceResponse` (never `null` —
    `null` would fall back to the real network for an `https://localhost/…` URL, which is
    meaningless and slow). Log the target *path* only, never the query/token.
  - anything that is not `_media` → `super.shouldInterceptRequest(...)` (asset loader).
  - seek past end → server `416` passthrough unchanged.
- `MainActivity.java`: after `super.onCreate(savedInstanceState)`, call
  `bridge.setWebViewClient(new MediaProxyWebViewClient(bridge))` (bridge is protected in
  `BridgeActivity`; `setWebViewClient` installs ours on the live WebView).
- `network_security_config.xml` / `cleartext` / `allowMixedContent` unchanged (fetch needs them).

**Verify:** `testDebugUnitTest` green; `gradlew assembleDebug` builds; `npx cap sync android`
(if native shell assets touched).
**Commit 2:** `feat(android): native WebView media proxy (_media) with Range passthrough` → push.

## Phase 3 — Web-tier e2e guard (RED → GREEN)

Headless Chromium cannot execute the Java interceptor, but it *can* pin the client half
of the contract in a real browser (jsdom cannot decode media; see `e2e/playback.spec.ts`).

**RED/GREEN — new `e2e/native-media-proxy.spec.ts`:**

- Use `page.addInitScript` to stub `window.Capacitor = { isNativePlatform: () => true,
  Plugins: { MediaSession: { setActionHandler(){}, setMetadata(){},
  setPlaybackState(){}, setPositionState(){} } } }` and
  `localStorage.setItem("serverUrl","http://localhost:5173")` (the vite proxy origin —
  same-origin to the page, so login works exactly as today).
- Test A (shell): log in via the UI (in-memory session token is set by the real login
  path), open the longest book, assert the `<audio>` `src` `startsWith(
  "https://localhost/_media?url=")`, and the decoded inner URL matches
  `^http://localhost:5173/api/(audiobooks|tracks)/\d+/stream` and contains `media=`.
- Test B (control): identical flow with a *clean* context (no stub) — assert `src` stays
  same-origin (`/api/…/stream`, no `_media`).
- The interceptor itself is out of scope for Playwright; that is Phase 4. This test must
  not press Play (headless decode is covered by `playback.spec.ts`).

**Verify:** `make test-e2e` (stack up) green; if the stack cannot be brought up in WSL,
note that and run in CI-equivalent conditions.
**Commit 3:** `test(e2e): pin the native-shell _media URL routing in the browser` → push.

## Phase 4 — On-device verification (manual; blocks doc sign-off)

`npm run build:android` → `npx cap sync android` → `cd client/android &&
./gradlew assembleDebug` → install (`scripts/install-android.ps1` or
`adb install -r`). On WiFi, local instance selected, VPN off:

1. Cold start → streamed single-file M4B (with chapters): plays; scrub to 10 %, 50 %,
   90 %; chapter skip forward/back; pause/resume.
2. Per-track (multi-file) book: streams, advances across track boundary.
3. Lock screen: play/pause works; position scrubber updates; chapter prev/next.
4. Production instance (https) still streams (proxy is uniform — must not regress).
5. Downloaded book still plays with server stopped (`capacitor-file://` path untouched).
6. Long listen past the 5-minute token TTL, then seek: element errors → fresh token →
   resumes at position (existing `onError` ladder) — no visible failure.
7. Cold-cache cover check (fresh profile): covers load or fail as before (feeds Phase 6;
   either result recorded).
8. Reading of tunnel fallback: `adb reverse` build still works.

Tick the spec 26 A-criteria that were verified; leave the rest unticked honestly.

## Phase 5 — Docs (ADR + spec + LIMITATIONS)

**Commit 4:** `docs: ADR 031 native media proxy; spec 26 remote-streaming criteria; LIMITATIONS 1.4/1.6` → push.

- **ADR 031** `decisions/031-native-media-proxy.md` — status accepted; records the
  mixed-content-media finding, the chosen design, the allowlist, the alternatives
  rejected (see below) and the security trade-offs. Supersedes **ADR 014's media-path
  assumption only** (edit 014 header to `Status: Superseded by 031 (media path); the
  origin decision stands`); ADR 021 unchanged.
- **Spec 26** (`specs/26-android-app.md`) — new section "Remote streaming over the
  household LAN (media proxy)": behaviour + acceptance criteria:
  - app pointed at `http://<lan-ip>:3000` streams an undownloaded M4B and per-track book
  - seek inside an undownloaded book works (Range passthrough, 206/416)
  - seeks and tracks mint scoped media tokens; mid-book expiry retries once via the
    error ladder
  - the shell never puts an absolute http(s) stream URL on the media element; only
    `https://localhost/_media?url=…`
  - web/PWA build emits no `_media` URL
  - (A-criteria ticked only for what Phases 1–4 prove; on-device boxes stay unticked
    until Phase 4 runs)
- **LIMITATIONS.md** — update §1.4 (remote streaming over LAN http now routed via the
  media proxy; 5-minute token caveat) and §1.6 (mixed-content finding corrected: fetch
  was never the whole story; media element auto-upgrade was the residual gap). If Phase 6
  is not done, record "covers over plain http may fail on a fully cold cache" as known.
- **PLAN** (this file) updated to "implemented" with links.

## Phase 6 (optional — needs owner go-ahead) — Covers through `_media`

`coverUrl()` already mints a scoped cover token in the shell. Wrap its native result in
`mediaProxyUrl` too; `<img>` stops relying on the IndexedDB cover cache on cold starts.
Small: one helper reuse, tests extended (`coverUrl.test.ts`), limited blast radius —
but it changes every cover request on existing installs, so it is opt-in.

## Alternatives rejected

- **Local HTTPS with internal CA** (Caddy `tls internal` / mkcert): correct but per-device
  CA install + IP-SAN churn on DHCP; reverses ADR 014/021's TLS rejection; owner chose proxy.
- **`androidScheme: "http"`** (http://localhost origin): no mixed content at all, but
  splits the storage origin (the 2026-10 storage incident); owner already rejected this once.
- **MSE progressive player**: JS-only but codec/Mse support risk in WebView, complex
  SourceBuffer/seek state machine; much higher regression surface than an interceptor.
- **Graceful degradation only**: not a fix.
- **Leave `<audio>` on absolute URLs and rely on `allowMixedContent`**: measured outcome —
  the element auto-upgrades and fails; this plan exists because that does not work.

## Risks & rollback

- Interceptor bug → media fails to load with a deterministic 502 → client error ladder →
  "Playback could not start". Rollback = one-line revert in `MainActivity` (or drop commit 2).
- Token expiry mid-book → one forced reload + position restore (existing ladder). No change.
- Large single-file M4B → element uses Range requests only; server streams 206s; no full
  buffering anywhere new.
- Commit points after every phase; `git revert` per phase is self-contained.
- Working tree hygiene: the pre-existing `package-lock.json` line-ending churn and
  untracked `.tmp/` are **not** touched by this work.

## Commit & push cadence

Commit 1 (client routing) → push · Commit 2 (native interceptor) → push ·
Commit 3 (e2e) → push · Phase 4 device pass → **Commit 4** (docs: ADR/spec/LIMITATIONS/plan)
→ push · (optional) Commit 5 (covers) → push.

## Open points for the owner

1. On-device verification (Phase 4) needs the phone attached — confirm which device
   (Pixel 4a / Defy) and that it is on the same WiFi as the server.
2. Phase 6 (covers through the proxy) — do you want it in this change or a follow-up?
