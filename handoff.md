# Handoff — Audiobook Manager Buildout

> **Purpose:** if this session is lost, an agent (or you) can read this file to
> recover exactly where work stands. Update it at the end of every work block.
> This file is the live progress log; `roadmap.md` + `specs/` remain the plan.
>
> **Known limitations and planned work live in
> [`LIMITATIONS.md`](LIMITATIONS.md)** — broken features, caps with reasons,
> security debt, and a suggested order of work. Read it first.

## ⚠️ Current task — the player, rebuilt around the listening position (2026-10-27)

Uncommitted work on `master`. **The owner stages and commits.**

The player was "completely broken" on the Android phone ("Playback could not
start"), after a chain of patches that each fixed one book shape and broke the
other. It has been rebuilt. Read this before changing it again; the history is
the whole explanation.

### Device verification update — 2026-10-27

The owner installed the updated APK on the Motorola Defy and confirmed that
offline access and the first-press fingerprint login fixes work. The Pixel 4a is
now connected for playback investigation.

**Pixel playback is now verified.** The current APK played "The Christmas Pig"
(`bookId=120`, local M4B `files/books/120/2588.m4b`, 321,857,108 bytes) from
the app-private file URL. The WebView audio element reached `playing`, advanced
past 28 seconds with no media error, Android reported active media playback,
and the owner confirmed hearing audio. The player rewrite is still uncommitted;
do not treat unit tests alone as device verification, but the reported failure
did not reproduce after the Pixel was connected and signed into a profile.

The setup issue was separate: the Pixel's HTTPS-origin storage had no active
profile, and its saved server address was `https://192.168.1.203:3000`, while
the server speaks plain HTTP. For this test, `http://localhost:3000` was used
with `adb reverse tcp:3000 tcp:3000`, then the owner signed in on the Pixel.
That localhost address only works while the USB reverse is active.

**Wi-Fi is still blocked.** A direct phone request to
`http://192.168.1.203:3000/api/health` and a raw TCP connection both timed out.
The PC server listens on `0.0.0.0:3000` and the PC can reach that LAN address,
so the phone's Wi-Fi-to-PC path (likely AP isolation, network segmentation, or
firewall policy) remains to be resolved. The app's example IP is only an
example; the correct scheme for this HTTP server is `http://`, not `https://`.

**Offline access option from Connect to your library screen added.** When the device has downloaded audiobooks, `ServerSetup` now offers a "Continue offline" action so the user is not trapped on the connection screen when the home server is unreachable. If profile state in localStorage was cleared while offline, `App.tsx` restores the active profile ID from the on-device encrypted cache envelope. The updated APK was rebuilt (`npm run build:android`, `npx cap sync android`, `gradlew clean assembleDebug`) and installed on the connected Pixel 4a (`07261JEC203154`) with reverse tunnel on port 3000 established.

### The four states of the player, and what each one got wrong

| | Commit | Model | Broke |
|---|---|---|---|
| **A** | `ad4dbee` | `currentIndex -> streamUrl`; one effect keyed on the URL | (worked, for multi-file books) |
| **A2** | `e0e022a` | same, plus `pendingSeekRef` + `desiredTimeRef` + `desiredTimeLockedRef`; `setCurrentTime(0)` on every source swap | seek showed 0 for a frame or two before landing |
| **B** | `a97b344` | single-file books get Track rows; `isChapterBook = chapters.length > 0`; chapters win in `parseSegments` | **a chapter book has one URL for all its chapters**, so "advance by changing the URL" stopped applying. Chapters never advanced. `f33219b`'s `onEnded` "fix" was unreachable: `ended` fires at the end of the *file*, when the index is already the last chapter, so its tests passed but real playback did not |
| **C** | `f33219b` + `010c779` | `remoteSrc` (media-token indirection) + `localTrackIdRef` | `streamUrl` could be `""` in the Android shell (`isNativeShell() ? "" : apiUrl(...)`) and `if (!streamUrl) return` meant the element never got a source; a token failure did the same. `localTrackIdRef` was set *before* resolving, so a cold start memoised "no local file" for the life of the player |

**The root cause in one sentence:** the state was "which media source is
loaded", when it is "where in the book am I". See
[`decisions/017-player-state-is-position.md`](decisions/017-player-state-is-position.md).

### What it is now

| File | Role |
|---|---|
| `client/src/lib/position.ts` | segments + all position maths (unchanged, one guard added: chapters are only used when a book has at most one track) |
| `client/src/lib/playback.ts` | **new, pure.** `planPosition(book, segments, kind, position)` → `{ segment, source, base, sourceTime }`; `planSegment`; `bookPositionFromSource`; neighbours; `segmentEnd` |
| `client/src/lib/playback.test.ts` | **new.** 24 tests incl. a round-trip invariant over every second of both book shapes |
| `client/src/lib/usePlayerSource.ts` | **new.** the only source resolver: local file → media-token stream → plain stream URL. Never empty. Retries local when the device library loads; `markLocalFailed()`; `retry()` for a fresh token |
| `client/src/lib/usePlayerSource.test.tsx` | **new.** 9 tests: local preferred, stream fallback, token failure, token timeout, late replica, local failure, token refresh |
| `client/src/components/ChapterPlayer.tsx` | rewritten around `position` + `pending` + `playIntent`; one `goTo(position, {play})` transport primitive; event handlers registered once and reading refs |

Invariants the rewrite relies on — do not "simplify" them away:

- `pending ?? position` is what the UI shows. That is why a cross-file seek
  never flashes back to the start.
- A seek **inside the loaded file** is a `currentTime` write. A seek **into a
  different file** is a position change, and the load effect re-applies the
  same position once the new file has metadata. There is no "pending seek"
  bookkeeping beyond the one `pending` position.
- **Advance is a position change, not an event.** A chapter book plays straight
  through a chapter boundary inside one file; `ended` means the *book* ended.
  A track book's `ended` means "load the next file" and uses the *loaded
  source's* index, not the element's clock (at the end of track 1 the clock
  reads track 1's duration, which is where track 2 starts — using it skips a
  track).
- The source is never `""`. If you find yourself writing `? "" :`, stop.
- The profile comes from `App.tsx` (`profileId` prop) with a stored fallback,
  not from `localStorage` read once at mount.
- **A deferred `play()` can be refused by the autoplay policy.** Tapping Play
  before the source has resolved means playback starts from the load effect,
  outside the gesture, and the browser answers `NotAllowedError`. That is not a
  failure to report: the source exists by then, so the next tap plays
  synchronously. `reportPlayFailure` distinguishes it from a real refusal —
  do not collapse them back into one message.

### Verification

Run from `client/`:

```bash
npx tsc -b            # clean
npx vitest run        # 39 files / 471 tests green (429 before this change)
npm run check:copy    # 422 strings, 0 errors
```

New tests worth knowing about: `playback.test.ts` (the mapping),
`usePlayerSource.test.tsx` (never-empty source), and in
`ChapterPlayer.test.tsx` — displayed position never goes backwards during a
cross-file seek, a chapter pick does not change `src`, chapter advance is
driven by `timeupdate` rather than a fake `ended`, a track book advances
exactly one track on `ended`, and a deferred Play refused by the autoplay
policy (`NotAllowedError`) is not reported as "could not start".

E2E (stack must be up):

```bash
scripts/e2e-wsl.sh e2e/playback.spec.ts   # 1 passed
```

### Remaining work, in order

1. **`e2e/playback.spec.ts` — run and green.** It proves the element gets a
   non-empty source, the stream delivers media (`duration > 0`), and pause
   sticks. Headless WSL Chromium has no ALSA audio device, so `currentTime`
   does not advance there — that is verified on the device instead. The stack
   must be brought up with `scripts/e2e-wsl.sh` (compose up, health wait, then
   playwright) in a single WSL session; the distro SIGTERMs containers when
   idle.
2. **On the phone (Pixel 4a / Defy)**: the debug APK is installed
   (`com.technative.audiobookmanager`, built at
   `client/android/app/build/outputs/apk/debug/app-debug.apk`, adb serial
   `07261JEC203154`). Point the app at the running stack
   (`http://<lan-ip>:3000` on its first screen; currently `192.168.1.203:3000`),
   then check streamed M4B playback, chapter advance, a scrub across a chapter,
   and downloaded playback with the server unreachable (airplane mode).

   **Root cause of the earlier "can't enter an IP" dead end** (fixed):
   `isNativeShell()` in `client/src/lib/platform.ts` checked
   `window.Capacitor.isNativePlatform()`, but `window.Capacitor` is only created
   by `@capacitor/core`'s module evaluation — which this app deliberately never
   imports at module scope (see `client/src/local/device.ts`, importing it
   before the bridge is ready blanks the screen). So `isNativeShell()`
   returned `false` on the device, `needsServerUrl()` returned `false`,
   `ServerSetup` never rendered, and the app fell through to
   `OfflineNotice` ("can't reach server", Try Again does nothing).
   The fix detects the native shell directly via `window.androidBridge` (Android)
   / `window.webkit.messageHandlers.bridge` (iOS) — exactly what Capacitor's own
   `getPlatformId()` checks — with `window.Capacitor.isNativePlatform()` kept as
   a fallback for tests. `ServerSetup` now renders on first run, the user can
   enter `http://192.168.1.203:3000`, and on submit the app fetches `/api/health`
   against that URL and reloads.

   If WSL restarts, the guest IP changes — re-run
   `scripts/expose-lan.ps1` to refresh the port proxy, then re-enter the URL on
   the phone if needed.

3. If a device check fails, the likely places are
   `usePlayerSource.resolveRemote` (token path) and the `onError` escalation
   ladder in `ChapterPlayer` — in that order.

### Spec and limitation updates made with this change

- `specs/06-chapter-support.md` — behaviour and acceptance criteria rewritten
  around the segment/source model.
- `decisions/017-player-state-is-position.md` — the ADR.
- `LIMITATIONS.md` — the unreachable `onEnded` branch and the memoised
  local-file guard are recorded as fixed-by-removal, with the reasoning.

---

## Current state (snapshot)

- Repo: `C:\Users\benle\Documents\Projects\TechNative\audiobook-manager`
  (also reachable at `/mnt/c/...` from WSL, which is where Docker runs).
- Branch: `deepseek-skill` tracking `origin/deepseek-skill` (requested from GitHub on 2026-10-24). The previous `master` branch and its one local-ahead commit remain preserved. An untracked Android `ExampleUnitTest.java` was already present after switching and has been left untouched. Specs `01..15, 15b, 16..28` and decisions `001..016` exist.
  **The current work is roadmap item 28 — accounts, passkeys and biometrics:**
  [`specs/28-accounts-passkeys-biometrics.md`](specs/28-accounts-passkeys-biometrics.md)
  and [`decisions/016-profiles-are-accounts.md`](decisions/016-profiles-are-accounts.md).
  Phases 1-8 implementation is present in the current worktree; production HTTPS deployment and interactive Windows/Android acceptance checks remain. The owner stages, commits and pushes.
- **Spec 28 in one sentence:** a profile is now an account with its own
  password, sessions live in SQLite, admin gates the operator surfaces,
  `APP_PASSWORD` is break-glass only, and private offline data is encrypted
  under a key derived from the profile password. Android uses the native
  fingerprint/face sensor; **passkeys are web-only, for Windows Hello.**
- **Phase status:**
  - **1 — docs, schema, migration: done.** `Profile.passwordHash` and
    `Profile.role`, plus `Session`, `DeviceCredential`, `WebAuthnCredential`
    and `WebAuthnChallenge`;
    `server/prisma/migrations/20261023120000_spec28_accounts/` renames
    `Playwright` → `test` and `Testing` → `admin-test`, keeps `Archie` if
    present, and inserts `admin` only when profiles already exist (a truly
    empty database is left to `seedDefaultProfiles`). Rehearsed with
    `prisma migrate deploy` on a temp database.
  - **2 — server auth foundation: done.** `server/src/auth/`:
    `password.ts` (built-in `node:crypto.scrypt`), `policy.ts` (8–128
    characters, weak list), `session.ts` (stores only a SHA-256 token hash;
    30-day sliding, 90-day cap), `service.ts` (login, claim, change, reset,
    unlock, exponential lockout, `createProfileSession`), `routes.ts`. Admin
    role gates and an auth hook live in `app.ts`. Identity is derived from
    the session: a member's forged `x-profile-id` is ignored.
    `server/src/auth.test.ts` now has 16 passing tests, including Android
    device credential enrollment, exchange, revocation and profile isolation.
  - **3 — client accounts: done.** `AccountGate` replaced `LoginGate`
    (deleted): account picker, password sign-in, claim, household break-glass
    recovery, lock, and password-required profile switching.
    `OfflineNotice`, `ProfileSwitcher`, `useLibrary` and `useBrowse` were
    adjusted for it.
  - **4 — encrypted offline cache: done.** `client/src/local/privateCache.ts`
    wraps a random DEK with a scrypt-derived KEK (N=32768, r=8, p=1;
    AES-256-GCM; AAD binds profile/table/row). Dexie v3 adds `keyEnvelopes`
    and `privateRows`; the replica strips `progress`, `favourited` and
    `inLibrary`; `OfflineUnlock` restores them only with the profile
    password. `privateCache.test.ts` (5) and `OfflineUnlock.test.tsx` (3)
    pass; `lockSession` clears the in-memory DEK.
  - **6 - web passkeys: implemented; automated validation passed.** The branch adds the
    WebAuthn server, client settings/sign-in, ceremony tests and
    `e2e/passkeys.spec.ts` with a virtual authenticator. The E2E virtual
    authenticator test passes. The complete server and client suites pass in
    Linux containers when the server test process has WebAuthn configuration
    unset (current full run: 507 server tests and 401 client tests passed).
  - **5 - Android biometrics: implementation present; device smoke check done.**
    The change adds a Capacitor `BiometricVault` backed by an AES-GCM Android
    Keystore key
    requiring `BIOMETRIC_STRONG`, server enrollment/list/revoke/exchange routes,
    Settings enrollment, account-gate exchange, offline DEK unlock and a
    five-minute background lock. The Android build and Gradle debug APK build
    succeeded; installed and launched on Pixel 4a (`07261JEC203154`) on
    2026-10-24. Biometric enrollment and unlock still require a running server
    and user interaction to verify. Focused client tests cover enrollment,
    online exchange, revocation, offline DEK restore and hidden enrollment
    while offline. Weaker face sensors may report unavailable and leave
    password sign-in as the path. Real sensor flows, background lock and
    offline unlock still require interaction on Pixel 4a and Motorola Defy.
  - **7 - HTTPS deployment: implemented, awaiting deployment checks.** Added
    `Caddyfile`, production Compose wiring for `books.home.arpa` with
    `tls internal`, secure cookie/WebAuthn settings, exact CORS origin and
    [`docs/production-https.md`](docs/production-https.md). Windows CA trust and
    Hello verification remain. Android remains HTTP on LAN per ADR 014.
  - **8 - hardening: implemented and automated checks pass; acceptance remains.**
    Media URLs use five-minute, profile/resource-scoped tokens; long-lived
    session tokens are no longer stored in browser localStorage or sent in media
    URLs. Added session/device labels, session list and revoke UI, logging
    redaction, the password-change screen with local DEK re-wrap, expired
    session/credential cleanup on login and startup, and corresponding tests.
    Caddy and production Compose validate; the migration was rehearsed on a copy
    of the live-shaped database; the `profile_unclaimed` code is now documented.
  - **Validation (2026-10-26):** `make test` passed in WSL with Node 24.22.1:
    copy check (422 strings, no errors/warnings), 28 server files / 507 tests,
    and 35 client files / 401 tests; `tsc --noEmit` is clean at both tiers.
    Existing jsdom media and React `act` warnings appeared; suites passed.
    Playwright (`scripts/e2e-wsl.sh`, stack restarted first):
    **51 passed in 4.3m, no flaky retries**, including the passkey
    virtual-authenticator registration/sign-in, the 8 phone-layout checks and
    all security cases. Added since the last snapshot: `auth/lockout.test.ts`
    (backoff ladder, which found that an expired lock never released),
    `auth/passkeys-origin.test.ts` (the ceremony is handed the configured
    origin/RP id), `migration.test.ts` (pre-account database → `migrate
    deploy`, including the rename collision case), `static.test.ts` (SPA shell
    public, API still gated), a cancelled-biometric fallback test, and a
    5s-timeout flake fixed with explicit timeouts. Windows CA/Hello and
    Pixel/Defy sensor flows remain manual.
- **Item 27, per-profile library membership, is built** (server and client).
  New profiles start empty; existing profiles are migrated to contain every
  book, so shipping it changes nothing for a household that already has the
  app. A separate "All books" tab is where books are added from; removing a
  book offers to delete its download too. The 512 MB cover cache is untouched
  by it.
- **The copy rule, and the thing to carry forward:** *a heading, an explanation
  or a hint must say why the listener is there and what they can do, in their
  terms — not what the system is doing.* `client/src/copy.ts` is split into a
  listener tier (the top level) and an operator tier (`copy.operator`), and
  `copy.test.ts` fails the build if the listener tier contains the system's own
  vocabulary.
- **The app now comes up offline instead of hanging.** Found on the Pixel 4a
  on 2026-10-21: a `fetch` to an unreachable host does not always fail, it
  **hangs** (a stale DHCP address on a network that blackholes packets never
  sends a RST), and the reachability probe had no timeout — so the app sat on
  the splash showing "Connecting…" for good. That is exactly the case the
  offline path exists to handle. `client/src/lib/reachability.ts` bounds the
  probe at 10s and `client/src/lib/api.ts` adds `boundedFetch` (30s) for the
  library and browse hooks. **Verified on the device**: with the server
  unreachable the app reaches the offline banner and the device library, with
  the covers from the cache — screenshot at
  `specs/evidence/offline-library-pixel4a-2026-10-21.png`.
- **A single-file book could be streamed but never downloaded.** The scanner
  only created `Track` rows for books of more than one file, and everything
  that *stores* audio is per track. Fixed, and **verified on the Pixel 4a**:
  "The Christmas Pig" (an M4B, 70 chapters, 307 MB) downloads to the device at
  the exact byte count and plays with the server cut off. The full account is
  in `LIMITATIONS.md` §5.
- **The devices' state after this session, so nobody is surprised:**
  - The **Pixel 4a** has the new build and the three books, and its server
    address is currently `http://localhost:3000` with an `adb reverse` tunnel,
    because the phone is on a WiFi segment that cannot reach the home LAN at
    all (ping to the host is 100% lost). The household's own setting is
    `http://192.168.1.203:3000`, and it is the right one on the normal
    network.
  - **Both phones cannot reach the LAN at all** (measured 2026-10-21). The
    Cisco AP `toob-9F4CE1` hands out a normal lease on 192.168.1.0/24 and
    then blackholes every packet to another device: the router and the host
    both answer nothing, and a connection to the host's port 3000 *hangs*
    rather than being refused. It is client isolation on the AP -- the host's
    firewall allows inbound TCP 3000 from the local subnet. So
    `http://192.168.1.203:3000` works for a laptop on the LAN and not for
    either phone, and the only route from a phone to the server is the
    `adb reverse` tunnel. **A household network problem, not an app
    problem**: put the phones on the main SSID, or turn client isolation off
    on that AP.
  - **The Defy** is with the household user. Its server address is
    `http://localhost:3000` (it needs the tunnel), and the app on it now says
    so plainly: "Could not reach the server. Check the phone is on the home
    network, and that the server address in Settings is right."
  - The **Defy** has the current build, and "The Christmas Pig" was downloaded
    **by the app itself** (16:58, 321,857,108 bytes in `files/books/120/`) and
    plays with the server cut off. Its server address is currently
    `http://localhost:3000` with an `adb reverse` tunnel, for the same reason
    as the Pixel. The household's own setting is `http://192.168.1.203:3000`.
  - **The "All books" tab works offline now.** It used to show the fetch error
    and an empty list, so the one thing the tab exists for -- taking a book
    out of your library -- was unreachable exactly when the phone was away
    from home, and it also claimed the household had no audiobooks. It now
    falls back to the books on this device (which is what the app's library
    already is offline) with a Remove that deletes the download. Membership
    lives on the server, so a removal that only changes a profile's library
    still cannot happen offline; a queue for that would need its own spec.
  - **`make device-tunnel`** brings the phone's tunnel back up. The tunnel dies
    with the adb connection and says nothing on the phone, so a download fails
    with "failed to connect to server" while the server is running fine. That
    is what happened on 2026-10-21, twice, and it is now a command rather than
    something to remember.
- App today: Fastify + Prisma + SQLite server (`server/src/index.ts`), React
  client, docker-compose; test media in `test/` (gitignored, local only).
  `test/` now holds ~3.6 GB: the LibriVox set plus six **commercial**
  audiobooks, including one M4B, because the product targets commercial books.
- **Spec 26 is much further along than this file previously claimed.** The
  foreground service, download to the device, the Dexie replica, cover URLs in
  the shell, the in-app server-URL screen and offline playback all work. The
  only unmet acceptance criterion is the visible downloaded-books list with
  "Remove from device", which the household removed from the polish pass on
  2026-10-19. See `LIMITATIONS.md` §1.4 and §3.
- Historical test counts from before passkey phase 6 and this Android phase 5 work (2026-10-24):
  **server 446 pass, 5 skipped** (14 of them auth), **client 374 pass** —
  but the full client suite has not been rerun since `LoginGate` was deleted,
  and the new cache tests were run individually. `npx tsc -b` in `client/` is
  clean. Playwright has **not** been rerun since the account gate, lock and
  offline-unlock changes; run it from WSL via `scripts/e2e-wsl.sh`.
  `make check-copy` had two banned-word hits for "cache"; the wording was
  changed and the check has not been rerun.
  These counts do not validate the passkey or biometric changes in the current worktree.
- **Pushes are the owner's call.** Feature 3 (`cb28038`) was pushed from this
  session; the doc commits after it were left for the owner to push.

## Working agreement

- Implement roadmap features in order. 01–25 are done except **13 (deferred,
  stretch)**; **15 (GUI redesign) landed 2026-10-18**; **15b is done**; **28 is
  the current session**. See "Build order after 14" in `roadmap.md`.
- Each feature claims a spec; when done, update its checklist in the spec file
  and mark it done in this handoff.
- **An unchecked acceptance criterion is not evidence.** Spec 21 shipped a
  criterion marked done that no code enforced; see "Current task". Before
  ticking a box, confirm the behaviour is reachable from a real call site.
- Tests are part of done-ness (spec 02 stands up the harness; features may add
  targeted unit tests as they go).
- Ask the user before deviating from spec order, restructuring infra, or when
  a product decision is needed.
- **Say what you are about to push to a phone.** Never rebuild or reinstall an
  APK while someone is mid-listen; it looks exactly like playback dying.
- **Never take the phone offline to test offline behaviour.** The `adb reverse`
  tunnel is the phone's only route to the server -- the device is on a WiFi
  segment that cannot reach the home LAN -- so removing the tunnel leaves the
  phone blocked until the owner asks for it back. Ask them to turn on
  airplane mode instead. (The household's rule, 2026-10-21.) Where a test
  needed offline behaviour without airplane mode, the phone's network was cut
  at the browser layer over the DevTools protocol
  (`Network.emulateNetworkConditions`), which leaves the tunnel and the
  device's network alone -- and, unlike overriding `window.fetch` by hand, it
  exercises the app's own error handling, which is the thing under test.
- **A phone's WebView throttles its timers when the screen is off.** A
  `setTimeout` loop in a page that is not visible can be throttled to once a
  minute, so a measurement that polls from the page can look like a hang.
  `adb shell svc power stayon true` keeps the screen awake for device tests.

## Progress log

| Item | Spec | Status | Notes |
|------|------|--------|-------|
| 01 | scanner-consolidation | **done** | single scanner module; duplicate deleted; contributor upsert fixed (name+role unique migration); releaseDate/genre ported; pure helpers in `scan-utils.ts` with 6 Vitest tests; `tsc --noEmit` clean |
| 02 | test-infrastructure | **done** | server Vitest, client Vitest+RTL (jsdom ^25 pin), Playwright root config (chromium + security projects), smoke + security placeholder E2E green. Chromium deps installed via sudo by user. |
| 03 | user-profiles-auth | **done** | buildApp() extraction, APP_PASSWORD cookie gate, Profile model + migration, profile CRUD, client LoginGate/ProfileSwitcher, 13 server tests + e2e green. **This session:** Profile.name unique (DB index + 409 handler + client error), ProfileGate forces profile pick before app renders, default profiles (Dad, Mum, Archie, Ben, Playwright, Testing) auto-seeded on first boot of an empty DB + `npm run seed:profiles` script |
| 04 | progress + listening history | **done** | PlaySession model + migration, PUT/GET progress (clamped, profile-scoped, upserted on a unique (book, profile) key), POST sessions, GET /api/history, ChapterPlayer resume/save/session flush. **Session 1:** fixed periodic 10s save (timer no longer resets on every position tick), player blocks playback with a hint when no profile is selected (was silently losing progress), resume e2e added. **Session 2 (resume bug + hardening):** client teardown/restore-seek fixes (commit `6b4e861`), then the duplicate-resume-row race eliminated server-side with a unique index + upsert, bound clamping for progress and session rows, non-numeric id validation, and a real cross-book resume E2E. 33 server tests, 10 client tests, 11 Playwright tests green |
| 05 | playback-experience | **done** | 15s skip, persisted speed, sleep timer incl end-of-chapter, auto-complete, Media Session controls, client tsc errors fixed |
| 06 | chapter-support | **done** | scanner ffprobe chapter extraction for M4B/M4A/MP4, chapters JSON stored, ChapterPlayer unified segments (tracks OR chapters OR full). NOT yet verified against a real M4B (no ffprobe on dev host; verify via docker later) |
| 07 | metadata-enrichment | **partial (audited 2026-10-12)** | Open Library + Google Books candidates, apply candidate, covers downloaded locally, scanner preserves overrides. **But:** no manual override UI exists (only the API accepts one), no confidence shown, no route tests, no Fastify schemas on metadata routes, absolute server paths leak in list/detail/metadata responses, no description trimming. `specs/07` now carries a full audit section. Remediation folded into specs 16-20. |
| 08 | pwa-packaging | **done** | vite-plugin-pwa autoUpdate SW, manifest standalone, /api NetworkOnly, dev options on, playwright manifest check. TODO: real raster icons, Lighthouse audit |
| 09 | android-wrapper | **partial** | capacitor.config.ts scaffold points at server URL; APK build blocked on Android SDK on user machine |
| 10 | lan-deployment | **done** | @fastify/static serves client/dist w/ SPA fallback, Dockerfile.prod, docker-compose.prod.yml, restart-unless-stopped, media read-only mount |
| 11 | security-hardening | **done** | safePath confinement (symlink-safe) on stream/cover, ID validation, password type check, security playwright project green, COVER_DIR env |
| 12 | ai-features | **done (MVP)** | LLMAdapter + LMStudioAdapter, /api/audiobooks/:id/ai-suggest offline-safe candidate pick |
| 13 | media-tools | **deferred (stretch)** | requires explicit user confirm + backups; not implemented yet |
| 14 | listening-position-display | **done** | `client/src/lib/position.ts` (all position maths, pure + 34 unit tests), `ProgressTimeline` (native range input + aria-hidden tick/marker overlay + chapter sub-bar, 9 tests), player readout "Track 7 — 07 - THE PREMATURE BURIAL / 13:33 into this track · 34% / 50% of the book · 2h 34m left", `/api/audiobooks` gains profile-scoped `progress`, grid "Continue listening" section. See "Current task" |
| 16 | provider-expansion | **done** | Audnexus + LibriVox clients, adaptive sequential chain (ADR 008) with METADATA_PROVIDER_ORDER override, resumable EnrichmentRun, auto-apply >=0.9 else review queue. **Live-verified** via `npm run verify:enrichment`, which found 4 bugs mocked tests could not (see below) |
| 17 | tag-taxonomy | **done** | curated 2-level genre tree (14 top-level, ~40 children) seeded at boot, GenreMapping with Misc catch-all, reconciled multi-narrator Contributor, Series with stored case-folded key + fractional position, publication facts, per-field FieldOverride precedence (ADR 009), reset + reset-all |
| 18 | favourites-custom-tags | **done** | per-profile Favourite (unique index = idempotent), household-managed Tag vocabulary with merge + reserved/genre-collision rejection. `PUT /api/audiobooks/:id/tags` is now ONE route for the whole suite (specs 17+18 originally collided on it) |
| 19 | recommendations-wishlist | **done** | external-only Discover seeded by one book or profile favourites, pure weighted tag-similarity ranking + hard dedupe on normalised title+author (ADR 010), per-profile WishlistItem with owned marker, structurally non-playable (no filePath/Track/audio route) |
| 20 | browse-discover-ui | **done** | 4 tabs (Library/Browse/Discover/Favourites), genre + series shelves, filter bar with URL state, full tag-suite editor with provenance labels, tag manager, review queue with confidence. Pure logic in `lib/browse.ts` (47 tests) |
| 21 | official-chapter-titles | **done** | `metadata/chapters.ts`: provider chapters matched to tracks by **filename identity** (LibriVox `listen_url`), positional only on exact count agreement, `isBetterChapterTitle` never steps backwards. Scanner strips redundant number prefixes at scan time. Audnexus chapters via ASIN (ADR 011). Hand-set titles are `FieldOverride` rows keyed `trackTitle:<n>`, surviving rescans. `make enrich` target added |
| 22 | search | **done** | `lib/search.ts` (pure): bare words match title/author/narrator/series/tag/genre/description; `author:`/`genre:`/`narrator:`/`series:`/`tag:` narrow to one facet, case-insensitive on substrings; quoted values keep spaces; terms AND. Separate layer from the chip `Filters` so a typed substring cannot blank the library. `q=` in the URL. `SearchBar` on Library + Browse |
| 23 | cover-fallback | **done** | `selectCoverSource` (pure): when the winning candidate has no `coverUrl`, the highest-confidence candidate that does supplies the image. Borrows **only** the cover, never other fields. Fixes the LibriVox case — its feed has no cover-art field, so the provider that best identifies the book was the least able to illustrate it. No new provider, no guessed endpoint |
| 24 | narrator-resolution | **done** | `narrator.ts` (pure, 22 tests): `composer` atom → `comment` (`Read By X`) → bracketed folder name (`{Stephen Fry}`). Full casts become one contributor per person. Person-name guard stops `{Unabridged}` being credited as a narrator. No guess when nothing matches. Makes the narrator work for commercial audiobooks, which no free online source can supply |
| 25 | catalogue-enrichment | **done** | Genres/series/publisher/year/ISBN/description populated from both catalogues. Six root causes fixed: unrequested `fields=`, unread default fields, author polluting the query, study-guide spam, non-idempotent candidate storage, and a missing Google Books key. Auto-apply banded 0.7–0.9 with an author guard. **Note: enrichment is not deterministic run to run.** |
| 15b | post-testing-polish | **done** | Spec `specs/15b-post-testing-polish.md`; evidence `user-testing-2026-10-18.md`. Shipped: **4** refresh never blanks the library (`235aa28`), **5** player-first book page (`35316d5`), **1** cover cache + tri-state cover (`4a7df3c`, on-device fix `fb19435`), **3** Discover 5-at-a-time + "Show 5 more" (`cb28038`), and **7** the copy review. `client/src/copy.ts` holds every string, split into a listener tier and an operator tier, with a build-failing jargon guard; the voice decision is in `PRODUCT.md`. Findings 2 and 6 were deliberately out; 2 became ADR 016. |
| 27 | per-profile-library | **server done, client done** | Spec `specs/27-per-profile-library.md`. `ProfileLibraryEntry` (a row per profile+book, unique), `Profile.followsServerLibrary` (the existing-vs-new distinction), `GET /api/audiobooks` scoped to the caller's membership, `GET /api/server-library` with an `inLibrary` flag, `POST`/`DELETE /api/audiobooks/:id/library`, and the scanner adding new books to every following profile. The data migration gives every existing profile every book, so shipping it changes nothing for a household that already has the app. Client: an "All books" tab (heading: "Select books to add to your library"), removal from the book detail that asks about the download only when there is one, and three distinct empty states. |
| 26 | android-app | **Sprint 2 done** | Offline listening on Android. `specs/26-android-app.md` + ADR 012. Device is a **read replica + progress**, not a second library manager. **Verified on device: cross-origin auth (header token, cookie is dropped cross-scheme), cover art, download with real progress.** All 5 tracks of a book downloaded byte-for-byte identical to `Content-Length`. Stage tracing (`trace.ts`) makes every pipeline step time-boxed and visible. See "Downloads" in Current task for the four bugs behind this. **Next: server-URL gate, then offline playback with the network off** |
| 28 | accounts-passkeys-biometrics | **all 8 phases implemented; only manual Windows/Android/Caddy checks remain** | Spec `specs/28-accounts-passkeys-biometrics.md`, ADR 016. `Profile` is the account (`passwordHash`, `role`); sessions live in SQLite and store only a token hash; admin gates scan/enrichment/taxonomy/library roots/profiles; `APP_PASSWORD` is break-glass only; login/claim/change/reset/unlock with exponential lockout. Encrypted offline cache: random DEK wrapped by a scrypt KEK, AES-GCM private rows, `AccountGate` + `OfflineUnlock`. Migration renames `Playwright`→`test`, `Testing`→`admin-test`, keeps `Archie`; automated pre-account migration test added. Web passkeys, Android biometrics, Caddy config and hardening are present; what is left needs a Windows machine, the phones, or a deployed CA. |
| — | **player rebuilt (2026-10-27)** | **implemented; 469 client tests green; E2E and device check NOT run** | Fixes 05/06. The player's state is now the listening position, not the loaded source: `lib/playback.ts` (pure mapping, 24 tests), `lib/usePlayerSource.ts` (local → token → plain URL, never empty, 9 tests), `ChapterPlayer.tsx` rewritten around `position`/`pending`/`playIntent` with one `goTo`. `profileId` now comes from `App.tsx`. ADR 017. See "⚠️ Current task" at the top of this file for the history and what is left. |

## Bugs found by the live enrichment run (`npm run verify:enrichment`)

Unit tests with mocked HTTP could not have caught any of these; every one
silently degraded enrichment to zero results. Worth re-running against any
real library, and worth keeping the script.

1. **Scanner ignored the album tag** - multi-file books were titled after the
   folder, which for this library is an archive.org identifier
   (`12_creepytales_1206_librivox`). LibriVox and most rippers put the *book*
   title in the album tag. This was the single biggest user-visible bug.
2. **Enrichment queued nothing** - `NOT: { enrichmentStatus: 'applied' }`
   compiles to `NOT (col = 'applied')`, which is NULL (not true) for a NULL
   column, so every never-enriched book was excluded.
3. **LibriVox returns HTTP 500 when `title` and `author` are combined.** The
   client always sent both. Author is now used locally in `scoreMatch`.
   LibriVox also exact-matches titles and drops leading articles, so
   `titleVariants()` tries stripped/decoded/article-free forms.
4. **Section readers use `display_name`**, not first/last name, so narrators
   came back empty for every LibriVox title. Life spans
   ("Kara Shallenberg (1969-2023)") are stripped.

Verified result: 6 books scanned, folder names replaced by real titles
("Creepy Tales", "The Awakening", "Charles Dickens 200th Anniversary
Collection Vol. 1"), 3 enriched at confidence 1.00 with narrators and mapped
genres, 3 correctly held in the review queue.

## Environment notes (Windows dev host)

- `@rollup/rollup-linux-x64-gnu` was pinned as a direct devDependency in
  `server/package.json`, which broke `npm install` on every non-Linux host.
  Removed; rollup resolves its own platform binary.
- Prisma needs a forward-slashed `file:C:/...` URL on Windows; `file:///` and
  raw backslash paths both fail. A test's `prisma` cwd was also one level
  short of the server root.
- Temp-dir cleanup and the `symlinkSync` privilege probe no longer fail
  otherwise-green suites. One test skips without Windows Developer Mode.
- Spec 02's Docker/E2E tier still needs Docker, which is unavailable here.
- **The bash entry points must stay LF.** Windows `git` is configured with
  `core.autocrlf=true`, which rewrote `scripts/e2e-wsl-setup.sh` to CRLF; bash
  then fails on line 1 with `set: pipefail: invalid option name` and the whole
  E2E suite is unrunnable from WSL while looking like a Docker or Playwright
  fault. `.gitattributes` now pins `*.sh` to `eol=lf`. If any script starts with
  "$'\r': command not found", that is the same cause.

## Build order after 14

**16 → 17 → 18 → 19 → 20 → 21 → 15.** Specs live in `specs/16-` through
`specs/21-`; ADRs 008/009/010 cover the provider chain, field-level precedence,
and the recommendation engine, and ADR 011 supersedes part of 008. Item 15
(GUI redesign) moved to last so the redesign styles the final browse surfaces
instead of rebuilding them. Item 13 (media tools) stays out of scope - media is
a read-only mount by design. **After 15: 26 (Android offline), 27 (per-profile
library) and 28 (accounts/passkeys/biometrics), which is the current work.**

## Current task

> **Deferred while the player rewrite at the top of this file is in progress.**
> Everything below is roadmap item 28 and remains accurate; only manual
> Windows/Android/Caddy checks are left there.

### Next action — read this first

**Roadmap item 28 is the current work.** Contract:
[`specs/28-accounts-passkeys-biometrics.md`](specs/28-accounts-passkeys-biometrics.md);
decisions: [`decisions/016-profiles-are-accounts.md`](decisions/016-profiles-are-accounts.md).
Phases run in order; see the snapshot above for what each one contains.

| Phase | What | Status |
|---|---|---|
| 1 | Docs, schema, additive migration | **done** |
| 2 | Server auth foundation + role gates | **done** |
| 3 | Client accounts, lock, break-glass | **done** |
| 4 | Encrypted offline cache | **done** |
| 6 | Web passkeys (Windows Hello) | **implemented and E2E virtual authenticator passed** |
| 5 | Android biometrics | **implementation and APK/device launch validated; enrollment flow needs server setup** |
| 7 | Caddy + `books.home.arpa` + local CA | **config written and validated; deployment and CA trust need the Windows machines** |
| 8 | Hardening, session/device UI, audit, rehearsal | **implemented; automated checks pass, manual checks remain** |

**Phase 6 - web passkeys, implemented and validated on this branch.**

The following numbered plan describes the work already present; it is retained as an implementation map. The ceremony tests and virtual-authenticator E2E check pass.

1. `server/src/auth/passkeys.ts` with `@simplewebauthn/server`:
   `generateRegistrationOptions` / `verifyRegistrationResponse`,
   `generateAuthenticationOptions` / `verifyAuthenticationResponse`, challenge
   rows in `WebAuthnChallenge` (single use, short expiry, bound to the profile
   and the ceremony), credential listing/removal, and counter-regression
   rejection.
2. Routes in `server/src/auth/routes.ts`, following its style:
   `/api/auth/passkeys/register/options|verify`,
   `/api/auth/passkeys/login/options|verify`, `GET`/`DELETE
   /api/auth/passkeys`. Gate every route on `WEBAUTHN_RP_ID` and
   `WEBAUTHN_ORIGIN` and answer `passkey_not_configured` when either is unset.
   The login paths are already public in `isPublicApiPath`.
3. On a successful assertion call
   `auth.createProfileSession(profile.id, "profile", meta)` — a passkey is a
   sign-in method, never a second factor beside a password.
4. Server tests: a virtual authenticator registers and signs in, a replayed
   challenge fails, a counter regression is rejected, and the unset-env path
   answers `passkey_not_configured`.
5. Client: `@simplewebauthn/browser`, "Sign in with Windows Hello" on
   `AccountGate`, and add/remove passkeys in Settings. Hide the controls when
   `window.isSecureContext` is false or the server says passkeys are
   unconfigured. New strings go in `copy.ts` (`copy.security`).
6. Playwright: a CDP virtual authenticator
   (`WebAuthn.enable` + `WebAuthn.addVirtualAuthenticator`) registers and
   signs in; a mismatched origin must fail. Run via `scripts/e2e-wsl.sh`.

**Remaining work, in order:**

- **Phase 5 follow-up — interactive device verification.** On the Pixel 4a,
  configure the app against the running server, sign in with a profile password,
  enroll the Vault, then check online biometric sign-in, cancel/password
  fallback, revocation, background lock and offline DEK unlock. Repeat what the
  device supports on the Motorola Defy. Do not clear the persistent app data.
- **Phase 7 — HTTPS.** Caddy with `tls internal` serving
  `https://books.home.arpa` and proxying to the API; install the local CA on
  the Windows machines; set `WEBAUTHN_RP_ID=books.home.arpa` and
  `WEBAUTHN_ORIGIN=https://books.home.arpa`. Keep `localhost` valid for dev
  and Playwright (it is also a secure context). Document that
  `http://192.168.1.203:3000` cannot support passkeys — WebAuthn needs a
  hostname, not an IP.
- **Phase 8 — hardening.** Done in code: media tokens, signed-in-devices UI,
  the password-change re-wrap UI (`PasswordSettings`), expired-row cleanup,
  logging redaction, the `profile_unclaimed` error, the live-database migration
  rehearsal and a copy review. What remains is acceptance, not code: the manual
  checks in spec 28 (Windows Hello, both phones, offline, break-glass) and a
  final Playwright run against the deployed stack.

**Verification before calling a phase done:**

```bash
cd server && npx tsc --noEmit && npm test
cd client && npx tsc -b && npm test
make check-copy
scripts/e2e-wsl.sh        # from WSL, where Docker lives
```

Sync the counts into the snapshot above. **A green Vitest run is not a
typecheck** — run `tsc` separately (see the 15b note below).

### Traps from the spec 28 work so far

- **`x-profile-id` is not identity any more.** The server derives the profile
  from the session. A member's forged header is ignored. Only a household
  break-glass session (`profileId = null`) may still pass a profile id, which
  is why the older tests keep passing; do not "simplify" that while the
  migration is in flight.
- **A session bootstrap cannot unlock the cache.** `rememberProfileKey` runs
  on password login/claim only. Reloading with a cookie re-authenticates but
  leaves the DEK unset, which is why `OfflineUnlock` exists.
- **A failed unwrap deletes the old envelope.** That is deliberate — it is
  what covers an admin password reset. Do not turn it into a silent retry.
- **`check:copy` bans the system's own vocabulary in the listener tier**,
  including "cache". Say "saved profile data" / "protected profile data".
- **The passkey E2E needs Docker** and therefore WSL. CI seeds the
  `test`/`admin-test` passwords; production never does (`seed.ts`).
- **Passkeys need HTTPS or localhost.** Windows Hello will not appear on a
  plain-HTTP LAN address; phase 7 is what makes the household URL work.
- **`secondsUntil` clamps to at least 1, so it cannot answer "is the lock
  over?".** `lockedSeconds` reused it, which meant an expired lock reported one
  second remaining forever and a five-failure lockout never released. Use the
  raw difference for expiry and the clamp only for the retry-after header; the
  ladder is pinned by `auth/lockout.test.ts`.

### Historical record — 15b and earlier

The rest of this file is the record of earlier sessions. It is kept because
the reasons are the useful part; the plan above supersedes it.

**The 15b copy rule still applies, and is the thing to carry forward:** *a
heading, an explanation or a hint must say why the listener is there and what
they can do, in their terms — not what the system is doing.*
`client/src/copy.ts` is split into a listener tier (the top level) and an
operator tier (`copy.operator`), and `copy.test.ts` fails the build if the
listener tier contains the system's own vocabulary.

**15b's five features shipped:** refresh never blanks the library
(`235aa28`), player-first book page (`35316d5`), cover cache + tri-state
cover (`4a7df3c`, on-device fix `fb19435`), Discover 5-at-a-time
(`cb28038`), and the copy review. Findings 2 (per-profile privacy) and 6
(lockscreen latency) were deliberately left out; 2 needed an ADR (which is
now ADR 016) and 6 needs measuring.

**Also shipped with 15b: roadmap item 27, per-profile library membership.**
Spec [`specs/27-per-profile-library.md`](specs/27-per-profile-library.md),
server and client. New profiles start empty; existing profiles were migrated
to contain every book, so shipping it changed nothing for the household.

**The Android offline path is functional.** Downloads work end to end and
were verified byte-for-byte (commit `6c2fbf1`). The historical record below is
kept because getting there took four wrong turns and the reasons are the
useful part.

### Feature 3 (Discover) — what shipped, and the three bugs under it

`cb28038`. The tester said results came back "at random" and asked for "top 5
at a time, then allow a 'load more' button". Both halves are one change:
**the pool is ranked once and then sliced**, so page two continues page one
rather than being a fresh draw.

- **Server.** Open Library subject search gained `page`/`limit` paging, an
  identifying `User-Agent` (identified requests get 3× the anonymous rate
  limit), an 8s `AbortSignal.timeout`, and a 30-minute per-`subject:page` pool
  cache with a `clearSubjectPoolCache()` seam. A **failed** page is never
  cached, so an outage cannot blank Discover for half an hour. Ranking gained
  published-decade proximity (by **median** decade, not mean), next-in-series
  and cover-present, all as pure tested functions with small weights — a real
  tag match still outranks them, and there is a test for exactly that.
- **Client.** `useDiscover` gained `page`, `hasMore`, `loadingMore` and
  `loadMore()`, which **appends**. The UI shows five cards and a "Show 5 more"
  button that disappears at the end, plus a "Showing N of M" line.

**Three bugs, in the order they had to be found:**

1. **The button did nothing, and nothing errored.** The Discover component's
   effect listed the whole `discover` object in its dependencies — and the hook
   returns a fresh object every render. So clicking "Show 5 more" set
   `loadingMore`, re-rendered, re-ran the effect, and **re-fetched page 1 over
   the top of the page it had just appended**. The list never grew past five
   and there was no error, no log, no console message. Fixed by depending on the
   stable `useCallback`s. This is the same class of bug as the
   "unchecked acceptance criterion is not evidence" note above: **a change that
   fails silently is the expensive kind.**
2. **The E2E failed against stale code.** After the fix, the E2E *still*
   failed — because the Vite dev server in Docker does not see edits made over
   the `/mnt/c` bind mount. `docker compose restart client` and it passed.
   `LIMITATIONS.md` §5 records this; the symptom is identical to "my fix does
   not work".
3. **A green suite that exited 1.** Adding a test file shifted the scheduler
   enough to expose a pre-existing race: an `EnrichmentManager` run was still
   updating its row after its test had torn the database down. The Prisma
   error escaped as an **unhandled rejection**, so every assertion passed and
   `npm test` still exited non-zero. `processRun` now treats P2025 as "the run
   was deleted; stop quietly". **A suite that exits non-zero on a green run is
   a broken suite.**

Also fixed on the way: the module-level `subjectPoolCache` outlived
`clearMocks`, so the first test's empty result was served to the next three.

**And one that was almost missed:** `recommend-service.test.ts` imported a type
that does not exist (`EnrichmentCandidate`; the real name is
`ProviderCandidate`) and set a field the type does not have (`hasCover`; the
service derives it from `coverUrl`). **All eight of its tests were green** —
`vitest run` does not typecheck — and the file did not compile. It was caught
by `npx tsc --noEmit`, which is a *separate manual step* and is easy to skip.
**A `typecheck` script on both packages, wired into `make test`, is queued as
item 17 in `LIMITATIONS.md` §6.** Until that lands, run `tsc` yourself: a green
suite is not evidence that the code compiles.

### Downloads: the four bugs, in the order they had to be fixed

1. **No authentication.** The WebView is cross-site relative to a plain-HTTP API
   (`https://localhost` → `http://...:3000`), so Chrome dropped the
   `SameSite=Lax` cookie outright — CDP showed *zero cookies stored*. Fixed by
   also returning the session token in the login body and accepting it in
   `x-house-session`. `4f960bb`
2. **Progress never fired.** The plugin's progress listener compared URLs with
   `!==`, which matched nothing. Migrated to `@capacitor/file-transfer` (the
   deprecated-API replacement) and filter on `type === 'download'`.
3. **`mkdir` broke every download after the first.** `Filesystem.downloadFile`
   took `recursive: true` and created parents itself; `FileTransfer` does not,
   so the migration called `mkdir` unconditionally — and that rejects an existing
   directory (`OS-PLUG-FILE-0010`). `60c4c62`
4. **The real one: the plugin loader hung.** `await fs()` never settled, because
   the lazy `await import("@capacitor/filesystem")` compiled to a Vite preload
   wrapper whose promise never resolved on device. `6c2fbf1`

### Why it took this long, and what to do differently

**A direct plugin probe was healthy while the app's own button did nothing**,
because the probe used `window.Capacitor.Plugins.FileTransfer` and the app used
the dynamic import. Two code paths, one broken, and I spent a long time proving
the network worked while no request had ever been made. **A probe must exercise
the same path as the failing feature**, not a convenient equivalent of it.

**Three "verified" claims were wrong**, each for a different reason: a CDP
timeout read as a failure (the phone was dozing), a fix verified in source but
never rebuilt into the APK, and a test that passed while asserting the wrong
element. Check *what is served and installed*, not what is on disk.

**The tracing that ended it was built after the third failure**, per the user's
instruction to make every stage throw a visible error rather than hang. It is
the reason this took one log line to diagnose rather than another afternoon.
`trace.ts` wraps every await in a per-stage budget, logs the stage *before*
running it, and the button renders the completed stages on failure. **Keep it.**
A promise that never settles cannot be caught by `try/catch` — only a deadline
surfaces it.

### Still open

- **`needsServerUrl()` has no call site.** On first run in the Android shell the
  app dead-ends: `ProfileGate` blocks the header, the header is the only route to
  Settings, so a new user cannot enter a server address at all. Needs a gate
  rendered before `ProfileGate`. Small, and higher value than anything else
  queued.
- **Downloaded audio is invisible to the user.** `Directory.Data` is app-private,
  so a file manager cannot see or delete downloaded books and the phone's Files
  app shows nothing. ADR 012 accepted this trade; for a household app it is
  probably wrong and is worth revisiting.
- **Progress conflict dialog** ("Use this / Keep what I have") fires readily on
  first play, because the phone and server disagree. Working as designed, but it
  blocks the UI.
- **Offline playback with the network off is still unverified end to end.** The
  files are correct on disk; nobody has yet pulled the cable and confirmed audio.

### Previously recorded (superseded above)

**Fixed and verified: cross-origin session auth (commit `4f960bb`).**

The handoff previously attributed the hang to CORS + a missing
`credentials: 'include'`. Those were real gaps but **not the cause**.
The actual cause: the WebView origin is `https://localhost` while the API is
plain `http://localhost:3000`. A different scheme makes it **cross-site**, so
Chrome dropped the `SameSite=Lax` `house_session` cookie outright — CDP showed
**zero cookies stored** — and every call after login 401'd while login itself
looked like it had succeeded. No CORS setting can fix this; it is the cookie
policy. `SameSite=None` would require `Secure`, i.e. real HTTPS, which a
plain-HTTP LAN server does not have.

Fix: login also returns the opaque token in the body, the server accepts it in
`x-house-session` as well as the cookie, and the client replays it as a header.
The cookie path is untouched, so the browser/PWA and Playwright are unaffected.
Verified on device: login 200 → token → a bare `fetch()` with no explicit
header returns 200 with the real profile list.

**Two traps this session, both worth not repeating:**

1. **The first credentials fix shipped a passing test and a broken app.** It was
   put in `apiFetch`, which is barely called — the app has ~8 duplicated private
   `request` helpers (`useLibrary`, `useBrowse`, `ReviewQueue`, `TagManager`)
   plus raw `fetch` in `LoginGate`, `ProfileGate`, `ProfileSwitcher`,
   `ChapterPlayer`, `AudiobookDetail`. Nothing routes through `apiFetch`, so the
   cookie never travelled. The fix now lives in the `installApiBaseUrl` shim,
   the only choke point every call passes through. **This is the third time this
   project has been bitten by "an unchecked acceptance criterion is not
   evidence" — grep the shipped bundle, not the source, before believing a
   client-side fix landed.**
2. **`unexpected token DOCTYPE` was not a bug.** It is what you get when a
   relative `/api/...` resolves to the bundled `index.html` because no server
   URL is configured. It looks exactly like a server fault and is not one.

**OPEN BUG — the app is deadlocked with no server URL.** `needsServerUrl()` in
`client/src/lib/api.ts` exists and is unit-tested, but **no call site ever uses
it** (same class of bug as above). On first run in the Android shell,
`ProfileGate` renders, its `/api/profiles` resolves to `index.html` (HTML where
JSON was expected), and it shows "Cannot reach the server. Unexpected token
'<'..." — but Settings is only reachable from the app header, which `ProfileGate`
blocks. The user has **no way to enter the server address**. Worked around by
setting `localStorage.serverUrl` over CDP. Needs a server-URL gate rendered
before `LoginGate`/`ProfileGate`.

**Remaining from Sprint 2:** still no book has been downloaded, so offline
playback is unverified end to end.

### Environment notes (this session)

- **Windows port 3000 is held by `iphlpsvc`** — that is *our own* `make lan`
  portproxy (`0.0.0.0:3000 -> 172.23.64.77:3000`), not a conflict. Docker binds
  3000 only *inside* WSL, so this is the intended design. Do not "free" it.
- **WSL kills the containers when the distribution exits** (already noted in the
  Makefile). Every `wsl -e bash` is a fresh instance, so `compose up` and the
  test must be one invocation, or WSL must be kept alive with
  `nohup sleep infinity & disown`.
- `JAVA_HOME` is **not set in a fresh shell**. JDK 21 is installed at
  `C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot`; `ANDROID_HOME` must be
  set to `C:\Users\benle\AppData\Local\Android\Sdk` too (`local.properties` does
  not exist and is machine-specific).
  **Update 2026-10-19:** a second JDK is now present at `C:\Tools\jdk21`, and
  `JAVA_HOME` is set to that one in the shell used for the device work. Both
  paths exist — use `C:\Tools\jdk21`.
- **`adb` is not on `PATH`.** It lives at
  `C:\Users\benle\AppData\Local\Android\Sdk\platform-tools\adb.exe`. The device
  is a **Pixel 4a, Android 13 (SDK 33)**, serial `07261JEC203154`.
  `client/android/local.properties` now exists with `sdk.dir` set (already
  gitignored by `client/android/.gitignore:27`).
- **CDP helper scripts read JS from a file, not from `argv`.** PowerShell's
  argument quoting mangles inline expressions badly enough to change their
  meaning. The helpers live in the temp directory, outside the repo:
  `run-e2e.sh`, `hold-stack.sh`, `probe-etag.sh`, `probe-discover.sh`,
  `cdp.mjs`, `cdp-stdin.mjs`.
- **Gradle's `clean` task cannot delete `build/`** — a daemon holds
  `build/reports`. Use `gradlew --stop`, then `Remove-Item -Recurse -Force build`,
  then `assembleDebug`. That is equivalent to `clean` and is what the "do not
  skip clean" rule was protecting against.
- The screen sleeps and the keyguard blocks automation. CDP hangs whenever the
  WebView is suspended, so the **user must unlock the phone and leave the app in
  the foreground** before CDP probes work.

### Where things stand

Committed and pushed. Local and `origin/master` are both at `4f960bb`.

Client 246 tests pass, server 375 pass (1 skipped), `tsc` clean on both tiers.
Playwright: `e2e/phone-layout.spec.ts` (5 specs) guards against the sideways-scroll
regression; run the full suite via `scripts/e2e-wsl.sh`.

---

**Session 2026-10-13 (Sprint 2 in progress): the phone can now reach the server,
and the app authenticates. Four blockers found and three fixed.**

Confirmed the user's "Add profile just hangs" was a real bug, not a flake:
`ProfileGate` had **no `try/catch`** around `fetch`, so a rejected request left
the promise unhandled, the form kept showing as idle, and the user saw a dead
Add button with no message. `LoginGate` already had one; `ProfileGate` did not.
Both guarded now, and the error text names the likely cause (cannot reach the
server / session expired) rather than a bare "Could not create profile".

### The four blockers, in the order they were hit

**1. The phone cannot reach the server at all. (Fixed.)** The stack runs inside
WSL, and WSL's NAT mode relays the server to Windows on **loopback only** —
`http://192.168.1.203:3000` was refused from the Windows shell. Found before
writing any app code, same discipline as the Sprint 1 spike.

`make lan` (`scripts/expose-lan.ps1`) adds a port proxy plus the firewall rule.
Two non-obvious details: the WSL guest IP **changes on every WSL restart**, so
a hand-typed rule silently rots and the script re-resolves it each run; and the
obvious `Private`-scoped firewall rule reports `Enabled=True` and **never
applies**, because Windows marks this machine's Ethernet `Public` (not on a
recognised domain). Scoping by `LocalSubnet` + `Any` fixed it. The rule is
*profile-scoped* because the profile is a fact, not a guess.

Also on the phone: after toggling WiFi it still had **no default route** and
could not reach its own gateway `192.168.1.1`, so it is in a segment with no
route — likely AP/client isolation. Unresolved from here; using
`adb reverse tcp:3000 tcp:3000` as the development path instead, which tunnels
over USB and needs no network at all.

**2. The service worker served the previous bundle after an APK update.
(Fixed.)** An APK rebuilt with a component deleted **still ran the deleted
component** — `SpikePlayer` kept appearing. Nothing in logcat. In the Android
shell the SW has no offline job (assets are bundled) and only risks stale code,
so `npm run build:android` (`vite build --mode android`) drops it. The WebView
survives an APK update, so this would have persisted until app data was cleared.
The root cause of the duplicate symptom was a *different* trap below.

**3. Gradle did not notice `cap sync` replacing every web asset. (Fixed.)**
Same symptom as above, two causes. The build script now runs `clean` before
`assembleDebug`, because Gradle's up-to-date check missed every replaced file
in `src/main/assets/public` and packaged the previous build's JS.

**4. Module-scope Capacitor imports blank the screen. (Fixed, but bit twice.)**
`registerPlugin` runs at import time; imported before the bridge is injected it
leaves a stub behind, and the first bridge call throws `Cannot read properties
of undefined (reading 'triggerEvent')` — blank screen, no useful stack.
`device.ts` now imports the plugin lazily via a deferred `import()`, and the
`import type` / `import { type X }` distinction mattered: esbuild keeps the
latter as a bare side-effect import, which is enough to re-trigger it.

### CORS: two separate switches, and a third that was missing

- **Network security config** (manifest) permits cleartext. Without it Android
  blocks plain HTTP from API 28, so both fetch and `Filesystem.downloadFile` fail.
- **`server.cleartext: true`** (capacitor.config) — the *WebView* switch. Missing,
  the request was blocked as **mixed content** from `https://localhost`.
  The two are independent; enabling only one gives a half-working app.
- **`credentials: true` on the CORS registration — the actual root cause of the
  hang.** Auth is a **cookie** (`house_session`), and a browser only sends and
  accepts a cross-origin cookie when the response carries
  `Access-Control-Allow-Credentials: true` alongside a **specific** origin.
  Without it the app is allowed by origin but 401s on every call, and login
  looks like it succeeded. Untested in Sprint 1 because the spike never
  authenticated.

Why the allow-list must stay an explicit array: `Access-Control-Allow-Origin: *`
is **illegal** alongside credentials, so a wildcard would both break the app
and widen access.

### Reaching into the WebView from adb

Chromium's remote debugging works and is far better than reading logcat:

```bash
adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
node cdp-eval.mjs "fetch('/api/health').then(r=>'HTTP '+r.status)"
```

Caught a blank screen in one call where logcat showed only React warnings.

### Not yet done

- The CORS credentials fix is now **complete on both sides**: the server sends
  `Access-Control-Allow-Credentials: true`, and `apiFetch()` sends
  `credentials: 'include'` so the `house_session` cookie crosses origins. The
  client test suite is 214 pass (+1 for the credentials assertion), `tsc`
  clean. **Still to verify on the phone** — the cookie path is untested on
  device until the APK is rebuilt and the app is exercised end to end.
- **No book has been downloaded on the device yet**, so offline playback with
  the network off is still unverified end to end.
- **Progress sync (Phase 3) untouched.** `allowRewind` is still not implemented.
- **`GOOGLE_BOOKS_API_KEY` still unset** — half the enrichment chain is inert.
- Settings screen reachable from the header; shows server address, connection
  test, bytes used, downloaded count, and an offline warning.
- `npm test` (client 213, server 368) and `tsc` both clean on both tiers.

**Session 2026-10-13 (Sprint 1 done): the native spike is answered — both ways
we hoped, with one important caveat found.**

Ran the spike APK on the user's Pixel 4a (Android 13 / SDK 33, chosen as the
strictest useful target). Commit `f414560`.

**The answer.** Audio *does* survive screen-off and seeking *does* work — but
**only behind a real foreground service**. With the web
`navigator.mediaSession` API alone there was **no media notification and no
lock-screen transport controls**, because there was no service behind the
session. Playback survived anyway, but only by luck; under memory pressure it
would not have. That is precisely the risk the spike existed to test, and it
justifies Capacitor rather than a PWA.

**The fix.** `@capgo/capacitor-media-session`, which decorates the existing
`<audio>` element instead of replacing it, so the web path stays intact. It
needs one non-obvious setting: `foregroundService: "always"` in
`capacitor.config.ts`. By default it only starts its service once playback is
*already* active, which races the first `setPlaybackState("playing")` from the
web layer; the service then never starts and the failure is a **silent no-op**,
not an error. Verified via `dumpsys`, not by eye: service running with
`startForegroundCount=1`, `category=transport` notification present,
MediaSession `state=3`, and position advancing 9.9s -> 186.5s across 180s of
`mWakefulness=Dozing`.

**Two false alarms worth remembering.**

- Playback "stopped and wouldn't restart" — **our test asset, not the app.** A
  *truncated* MP3 reports the full file's duration (30:55) while holding only
  10.4 minutes of audio, so "Seek 90%" jumped past the end of real data. A
  truncated MP3 lies about its duration; use complete files from `test/`.
- I briefly accepted the user's reasonable guess that a concurrent rebuild had
  killed it. It had not — no `npm run build` or `adb install` ran during their
  test. The file-length arithmetic settled it.

**Biggest practical win:** `adb` drives almost the whole checklist. `dumpsys
media_session` proves screen-off playback objectively, and `screencap` shows
what is on screen without asking the user. Two traps: PowerShell `>` corrupts
binary (use `cmd /c`), and `screencap` is black while dozing, so the lock
screen itself still needs a human.

**Also fixed:** the `server.url` bug from the previous session is gone — the
config no longer points at `localhost:3000` (which on a phone is the phone, and
loaded nothing). Spec 26's toolchain section now says JDK 21 is required and
that Android Studio was abandoned for the CLI SDK; `LIMITATIONS.md` §5 records
the installer stalls.

**Still open:** `GOOGLE_BOOKS_API_KEY` is unset, so Google Books returns
`{"error"}` and half the enrichment chain is inert. The mapping is written and
tested — only the credential is missing.

**Next:** Sprint 2 — download to the native filesystem (not IndexedDB:
`<audio>` cannot seek a blob in IDB), `convertFileSrc` seeking, Dexie for
metadata.

**Session 2026-10-13 (scope change): replan the app around offline listening.**

User feedback changed the scope: the household must be able to listen **away
from home**, on Android, sideloaded. The app cannot do this at all today, for
two reasons that were both deliberate when written:

- the PWA caches nothing (`runtimeCaching: /api/ → NetworkOnly`), so no network
  means no library;
- `client/capacitor.config.ts` hardcodes `server.url`, so the wrapper is a thin
  view of the server and is inert without it.

### The decision that shaped everything

Asked whether the whole stack could run on the device. The answer that mattered
was to ask what the device needs **without the server**: play audio, show the
library, resume. Everything else — scanning, enrichment, tagging, taxonomy,
Discover — stays server-side. The user confirmed this directly: tags and
enrichments must be *readable* offline once downloaded, but never *written*
offline.

So the device is a **read replica + a progress store**, not a second library
manager. That avoids duplicating ~22 tables and the entire domain model, which
is what "port the server to the phone" would have cost. See ADR 012.

Storage split: **Dexie/IndexedDB** for metadata (tiny read surface; one code
path across PWA and WebView; still jsdom-testable), **native filesystem** for
audio (an `<audio>` element cannot stream or seek a blob in IndexedDB).
Capacitor chosen not for native feel but for a **foreground media service**
(Android 13+ kills background PWA audio) and a **non-evictable filesystem**.

### The progress rule, and how the first proposal was wrong

First proposed "latest `lastPlayed` wins". The user correctly rejected it: if a
phone dies offline, another device gets further ahead, and the phone reconnects,
it overwrites the newer position.

Final rule: **progress never silently regresses, and timestamps are not used for
correctness at all.** Forward applies silently; backward ≤ 5 min applies
silently (genuine re-listening); backward > 5 min is **blocked and surfaced** as
a conflict dialog naming both positions, with "keep the further one" as default
and "use this device" as a single tap that *is* the confirmation.

Because the rule is monotonic, **clock skew stops being a correctness problem** —
a phone whose clock is fast that pushes forward is fine, and one that pushes
backward gets asked rather than silently applied.

### Files written

- `specs/26-android-app.md`
- `decisions/012-device-is-a-player-not-a-library-manager.md`
- `specs/09-android-wrapper.md` marked narrowed
- `roadmap.md` — item 26 added; **15 moved to last**
- `LIMITATIONS.md` — §1.4 (app cannot work away from home) and §1.5 (progress
  can silently regress) added as BROKEN

### Next

**Spec 26 Phase 1 — the de-risk spike.** Capacitor → download one file → play →
**seek inside the file** → **play with the screen off for 20 minutes**. If either
of the last two fails, the architecture changes, and it is far cheaper to learn
that before Phase 2 than after Phase 3.

**Earlier session 2026-10-13 (final): spec 25 — catalogue enrichment.**

Asked for "genre and all the other fields getting populated". Starting point on
the 12-book mixed library: genres 2/12, series 0/12, publisher 2/12, year 0/12,
description 2/12. Every one of those was a defect, not a provider limit.

Six root causes, all found by probing the live APIs rather than reading code:

1. Open Library returns 21 fields by default; we read 6. `series_name`,
   `series_position` and `first_publish_year` were **already there** — Harry
   Potter returned `series ["Harry Potter"]` position `4`, unread. Series was
   0/12 for that reason alone.
2. `subject`, `publisher` and `isbn` were **ABSENT**, because the search never
   passed `fields=`. Neither catalogue could supply genres at all.
3. Google Books returns `{"error"}` with no API key, so half the chain did
   nothing.
4. **The author was being concatenated into the search query.** That degraded
   results: `"Goblet of Fire J.K. Rowling"` returned only study guides; the
   title alone returned the real novel.
5. **Open Library indexes AI study-guide spam.** For Deathly Hallows the top
   two hits were *"Summary of Harry Potter and the Deathly Hallows"*
   (Bookhabits) and *"Conversations on..."* (Daily Books). The novel was not in
   the top five, and those score well precisely because the title is inside
   them.
6. **`storeCandidates` was not idempotent.** Title search returns *editions* of
   a work, so five editions produced five candidates with identical keys and
   violated a unique constraint — this is what failed The Ickabog, and it was
   pre-existing, merely masked by #4.

Also learned: Open Library merges every edition's subject headings, so one
Harry Potter volume returned ~60 strings across English, Spanish, German and
Hungarian, plus `nyt:childrens-middle-grade-hardcover=2020-11-29` and
`series:Harry_Potter`. Junk is now filtered before taxonomy mapping, and the
mapping is seeded from headings observed here rather than from genre theory.

### Result (live, 12 books)

genres 2→**11**, description 2→**11**, publisher 2→**11**, cover 9→**11**,
year 0→**8**, series 0→**6**, narrator 6→**8**, failures **0**.

### Enrichment is not deterministic

Two consecutive forced runs gave **applied 10 / review 1** and then
**applied 8 / review 4** on identical media, varying in which providers
answered. Nothing is cached between runs. Read these as a range, not a state.
Two books are *consistently* in review and both are correct: `Creepy Tales`
(best match is a different book, *"Twelve Creepy Tales"*) and the two `Short
Ghost and Horror Collection` sets, which intermittently lose the provider race.

### Still open

See [`LIMITATIONS.md`](LIMITATIONS.md) for the full list. The headline items:

- **`GOOGLE_BOOKS_API_KEY`** — the single biggest lever. The mapping is written
  and tested; only the key is missing. Google Books currently returns `{"error"}`
  so half the chain is inert.
- **Audnexus book metadata** — blocked on ASIN discovery, which has no free
  route (§2.1 there). Every candidate was tested and rejected.
- **`npm run scan` is broken** — `package.json` points at a file that does not
  exist. Use `make scan`.
- **No track-title / narrator editor UI** — spec 24 shipped the endpoint, but a
  human cannot use it yet.

Completed 2026-10-24: security dependencies were refreshed; root, server, and client audits report zero vulnerabilities. The remaining household-LAN HTTP transport gap is recorded in `LIMITATIONS.md`.

### Two judgement calls to sanity-check

- **The auto-apply band.** The user asked to lower the threshold. It is lowered
  to 0.7, but with an author-agreement guard, because `scoreMatch` is ~85%
  title-weighted and a bare drop would auto-apply books by the wrong author.
  The exception is an exact title match, which is what brought the two `Short
  Ghost and Horror Collection` books back — LibriVox records "Various" where
  the file tags a narrator. That exception is a judgement call, not a
  requirement.
- **`make enrich` force** remains necessary after any scan, because a scan
  resets `Track.title` to the embedded tag.

### Tests

Server 318 → **368**. New: 6 mapping tests, 9 genre-mapping integrity tests
(which caught two invalid slug targets on first run), 7 auto-apply tests, 6
dedupe tests, plus the junk-filter and non-book-title cases.
`tsc --noEmit` clean.

**Earlier session 2026-10-13 (later still): commercial audiobook support — spec 24.**

The user added six **commercial** audiobooks to `test/` (the LibriVox set is
test media only; the product is for commercial books). A full scan + forced
enrich over the resulting 12-book library showed the commercial half was
badly served:

- **narrator 3/12**, and all five multi-file commercial sets were empty.
- series 0/12, year 0/12, description 2/12, genres 2/12.
- 7 of 12 books parked in the review queue.

**Root cause of the narrator gap: it cannot be fetched.** Tested live, not
assumed — Audnexus has narrators but is ASIN-keyed; Open Library editions
expose only `isbn_10`/`isbn_13` and contributors like `Illustrator`; Google
Books and Apple iTunes have no narrator field; LibriVox 404s for commercial
titles. The reason is structural: **a narrator belongs to a recording, not a
book.** "Goblet of Fire" has dozens of recordings, so a title search finds the
*work* and still cannot say who read *this* copy.

**So the narrator is read from the files** (spec 24), most-trusted first:
`composer` atom → `comment` field (`Read By X`) → bracketed folder name
(`{Stephen Fry}`). All three were verified present in the fixture library.
A full cast becomes one contributor per person; a candidate must pass a
person-name check so `{Unabridged}` can never be credited as a narrator.

### Verified outcome (live, 12-book library)

| field | before | after |
|---|---|---|
| narrator | 3/12 | **6/12** |
| cover (served) | 9/12 | 9/12 |
| series / year / description / genres | 0 / 0 / 2 / 2 | unchanged |

All three newly-resolved books are commercial Harry Potter sets (Deathly
Hallows, Goblet of Fire, Order of the Phoenix), and **no false positives**:
`Harry Pooter Philanthropists Bone` and `Book 06 - ...` were correctly left
empty, because they carry no narrator in any tag or bracket. Those two are the
genuine misses, and the spec 17 tag-suite editor is the right answer for them.

This is the expected result rather than a partial one: every commercial book
that *can* be resolved from its own files now is.

### What the fixtures settled

- **The M4B has no ASIN anywhere** — not filename, not tags, not atoms. So
  Audnexus is unreachable for the entire commercial library, which is the
  binding constraint on everything above.
- **spec 06's M4B chapter path is verified for the first time.** music-metadata
  reported 0 chapters; **ffprobe found 66** properly-titled ones. ADR 011 had
  recorded this as unverified because no M4B fixture had ever existed.
- **The scanner already reads `common.composer` as the narrator**
  (`scanner.ts:145`), the Audible convention. I nearly reported it missing —
  worth checking rather than asserting.
- A stray non-audio `.txt` in a book folder did **not** create a phantom book.

### Corrections made in this session

Two of my own earlier claims were wrong and are now fixed in the repo:

1. **"Covers are 0/6"** was a measurement error — `publicMediaItem` strips
   `coverImagePath` by design (spec 11). Measured via the cover endpoint the
   library had **4/6**, three on disk before any of this work. Spec 23 is an
   enhancement, not a bug fix.
2. **"Adding an actor role needs a schema change"** was wrong. `Contributor.role`
   is plain `String` (`schema.prisma:88`), so no migration is needed.

**Actors are dropped permanently:** Audnexus's live payload has no
`actors`/`performers`/`cast` field — only `narrators`. Audible does not
distinguish them either, so spec 24 captures full casts as narrators.

### ASIN discovery: no free route exists

Tested every candidate. None works:
Audnexus `/books?title=` 404s (ADR 011); `/authors?name=` returns only
`asin`+`name`; `/authors/{asin}` returns no book list. Open Library has ISBNs
but no ASIN. Apple returns a `collectionId`, not an ASIN. The only remaining
route is Audible's own search, which needs a signed request with a fixed
private key — fragile and against their terms, which is what Audnexus exists
to avoid. **So wiring Audnexus in would improve zero of the current books.**
Keep it ready (region fallback, observability) but do not build a resolver.

### Tests

- `server/src/narrator.test.ts` — **22 new**. Negative cases weighted above
  positive ones, since the folder heuristic is the weakest source. Includes a
  table test over the exact six fixtures, asserting the three that must
  resolve to Stephen Fry *and* the two that must resolve to nothing.
- One real bug caught: `"Read by - Stephen Fry"` left a leading dash that
  failed the person-name check.
- Server 296 → **318**. `tsc --noEmit` clean.

**Earlier session 2026-10-13 (later): audited enrichment + shipped search (spec 22).**

Asked to confirm the tags were enriched (genre / artist / actors) and that a
user could filter by `author: X` or `genre: Y`. Checked against the running
stack rather than by reading code.

### What the audit found

Live stack, 6-book fixture library:

- **`GET /api/audiobooks` accepts no query parameters at all.** `?q=`,
  `?search=`, `?author=` and `?genre=` are *silently ignored* and each returns
  the entire library — no error, no empty result. `/api/search` does not exist.
  All filtering was client-side over the already-fetched library.
- **Enrichment coverage:** title 6/6, author 6/6, but narrator/description/
  publisher/genres only 2/6, **covers 0/6**, series 0/6, publishedYear 0/6.
  The 4 unenriched books are the ones sitting in the review queue from the
  earlier live run, so this is expected mid-state, not a new bug — but covers
  being zero is worth a look, since spec 07 claims cover download.
- **Contributors:** only `author` (6 distinct) and `narrator` (18 distinct).
  `MediaItem.author` and the `contributors` author rows were **consistent for
  every book** — good.
- **There is no "actor" concept anywhere.** `ContributorRole` is
  `author | narrator | translator | editor | illustrator`. Audnexus parses only
  `authors`/`narrators`; LibriVox only `readers`/`translators`; Open Library and
  Google Books have no performer field. Audible full-cast productions list
  everyone as narrator, so for audiobooks "artist" == narrator (covered) and
  "actors" does not exist as a distinct role. Adding one is a data-model
  change, not a filter change — deliberately **not** done here.
- **Two facets read from different sources:** `facetValues(book, "author")`
  reads `MediaItem.author`, while the narrator facet prefers the reconciled
  `contributors` rows. Author survives a manual override through the field;
  narrators do not. Consistent today, but the asymmetry is a trap.

### What shipped (spec 22)

Typed search, since none existed:

- `client/src/lib/search.ts` — pure. `parseSearchQuery`,
  `matchesSearch`, `applySearch`, `describeSearch`. Bare words search
  title/author/narrator/series/tags/genres/description; `field:value` narrows
  to one facet. Substring and case-insensitive, so `author: rowling` matches
  `J.K. Rowling` — the chips only ever offered exact values.
- **Deliberately a separate layer from the chip `Filters`.** A typed value is
  normally a substring, so pushing `rowling` into `Filters.author` would match
  nothing and silently blank the library. Search narrows the chip-filtered
  output instead.
- Facet terms resolve through the same `facetValues` the chips use, so a typed
  `author:` and a clicked Author chip can never disagree.
- Unknown `field:` degrades to free text rather than returning nothing.
- `SearchBar` on both Library and Browse, debounced, clearing on Escape,
  reporting "N matches for …". Query lives in the URL as `q=`.

Two bugs my own tests caught:

1. **The token regex had no `\s*` around the colon**, so `author: rowling`
   never became a facet — the optional field group rolled back and it parsed as
   two free-text words. Every faceted query with a space after the colon was
   silently broken.
2. **A bare `author:` with no value** was searched for as literal text and
   blanked the library with no explanation. Now dropped.

### Tests

- `client/src/lib/search.test.ts` — **27 new** unit tests.
- `client/src/components/SearchBar.test.tsx` — **10 new** render tests.
- `e2e/search.spec.ts` — **3 new** specs for the wiring: narrows the grid,
  survives a reload via the URL, `field:value` reports 0 rather than being
  ignored, clearing restores everything.
- Client suite 104 → **141**. `tsc --noEmit` clean.

Two harness mistakes worth remembering, both mine and both caught by the E2E:
`ensureAuthed` does a **relative** `fetch`, so it fails with "Failed to parse
URL" unless a `goto` has already run — every spec must `goto` before auth. And
`pickAnyProfile` waits for the **"All audiobooks"** heading, which only exists
on the Library tab, so entering on `?tab=browse` times out inside the helper;
pick the profile first, then click the tab.

**Still open, not fixed here (worth a decision):**

- ~~**Covers are 0/6 — root cause found.**~~ **CORRECTION: this was a bad
  measurement, not a bug.** The audit read `coverImagePath` from
  `GET /api/audiobooks`, but `publicMediaItem` deliberately **strips that
  field** — spec 11 forbids leaking server filesystem paths — and covers are
  served by `GET /api/audiobooks/:id/cover`. Measured the way the app actually
  serves them, the library had **4/6** covers, three of them on disk before any
  of this work started. Do not trust a proxy field over the endpoint that
  serves the thing; that is the same class of mistake as ADR 011.
- **Cover art now falls back across candidates (spec 23, shipped).** Still a
  real gap, just a smaller one: LibriVox's feed exposes **no cover-art field**
  at all, and Audnexus is ASIN-keyed, so the provider best placed to identify a
  LibriVox recording is the least able to illustrate it. A book whose winner has
  no `coverUrl` now takes its image from the highest-confidence candidate that
  does — borrowing **only** the image, the same independent-axis rule spec 21
  uses for chapters. No new provider and no guessed endpoint. Verified live: the
  LibriVox-matched Dickens collection gained a cover it could not previously
  obtain. The two still-uncovered books are both correct — one is below the
  auto-apply threshold, the other's candidates genuinely carry no cover URL.
- **No `actor` role.** If full-cast productions matter, that is a schema +
  provider-mapping change.
- **Author/narrator facet asymmetry** described above.
- **`handoff.md` still says "Owner pushes manually from their terminal."**
  Stale — pushes are automated. → **Resolved 2026-10-13:** work is now pushed
  to `origin/master`; the two remaining mentions are inside dated historical
  session entries and are left as an accurate record of those sessions.

**Earlier session 2026-10-13: spec 21 — official chapter titles — done.**

Chapter names came straight from the files' embedded tags, so the player showed
`Track 7 - 07 - THE TELL-TALE HEART` (the track number twice) or, worse,
`Section 01`. Providers know the real names. Spec 21 uses them.

What shipped:

- **`server/src/metadata/chapters.ts`** (new) — the matching rules, pure and
  separable from the DB:
  - `matchChaptersToTracks` matches a provider chapter to a track by the
    **audio filename the provider names**, not by position. Positional
    matching is what silently mislabels every chapter from the first
    divergence onward when a book is re-encoded or a file is added, so it is
    used only when the leftover counts line up exactly one-to-one — and even
    then only on tracks whose own title carries no information.
  - `isBetterChapterTitle` refuses any step backwards (`"The Tell-Tale Heart"`
    must never become `"Chapter 3"`) and reports an identical title as *no
    change*, so repeated enrichment runs don't churn correct rows.
  - `stripTrackNumberPrefix` removes `01 - TITLE` / `(4) Title` at scan time,
    independently of any provider, so unmatched books improve too.
- **LibriVox sections → chapters.** `sections[].title` is the real chapter
  name; `sections[].listen_url` carries the filename (`file_name` is usually
  null), which is what makes identity matching possible.
- **Hand-set titles.** `PUT /api/audiobooks/:id/tracks/:trackNumber/title`.
  Stored as a `FieldOverride` keyed `trackTitle:<n>` — *not* a column on
  `Track`, because the scanner deletes and recreates every track row on each
  rescan and would wipe it. Keyed by number rather than id for the same
  reason. Clearing deletes the row rather than storing `""`.
- **`make enrich`** — a forced enrichment pass. Required after any scan,
  because the scan resets `Track.title` back to the embedded tag.

Two bugs found and fixed while testing:

1. **The spec's own "never overwritten" criterion shipped unenforced.**
   `applyChapterTitles` accepted a `lockedTrackIds` option that **no caller
   ever passed**. The lock now lives in `FieldOverride` and is read inside
   `applyChapterTitles` itself, so no call site can forget it. Caught by
   reading the call sites, not by the tests — an unchecked acceptance
   criterion is not evidence.
2. **A run enqueued during another run was stranded forever.** `process`
   returned early on the `running` guard and nothing revisited the row, so it
   sat at `pending` with no feedback. Since a scan auto-enqueues a pass, this
   hit every manual run issued during a scan-triggered one.

Also fixed: `audnexus.ts` was missing its trailing newline.

Validation:

- `server`: **290 pass**, 1 skipped (Windows Developer Mode symlink probe).
  Was 270.
  - `chapters.test.ts` 28 → 35
  - `chapters.integration.test.ts` **new**, 6 (override enforcement, override
    survives a scan-style recreate, idempotency)
  - `app.test.ts` 8 → 15 (7 route tests for the title endpoint)
- `client`: 104 pass, unchanged.
- `tsc --noEmit` clean in both tiers.
- The override tests were verified to **fail** when the enforcement is
  removed — reverted, watched them fail, restored.
- Playwright: **32 passed** (21 chromium + 11 security), run via
  `scripts/e2e-wsl.sh` from WSL, where Docker lives. Spec 21 adds no E2E spec —
  chapter titles are asserted at the API/DB layer, which is where the logic
  lives — but the existing suite confirms nothing regressed.

**Earlier session 2026-10-06 (later): fixed the stale library grid.**

User-reported: listened to a book, went back to the library, and the progress
bar had not moved. Two compounding causes, both mine from spec 14:

1. **The library was never refetched.** `useLibrary` only fetched on mount and
   while a scan was running. Closing the detail modal only did
   `setSelectedBook(undefined)`, so the grid kept the `progress` values from
   page load. The server had the new position the whole time — the grid just
   never asked again.
2. **A naive refetch would have raced the save.** The player's unmount cleanup
   fires its final progress `PUT` as a fire-and-forget `keepalive` request, so
   refetching immediately after closing reads the *old* position. Fixed by
   making `ChapterPlayer` accept `onProgressSaved` and invoke it from the save's
   `.then()`, so the refetch is triggered by the write actually landing rather
   than by a guessed delay.

Fix:

- `useLibrary.refresh({ silent })` — a refetch that does not flip `loading`.
  Without this, every background refetch replaced the whole shelf with
  "Loading library..." to update one bar. The E2E asserts the placeholder never
  appears after closing.
- `ChapterPlayer` → `AudiobookDetail` → `App` thread an `onProgressSaved`
  callback, held in a ref so the unmount effect keeps its `[]` deps.
- `App` also refetches on window `focus` and on `visibilitychange` → visible,
  which covers listening that happened on another device.

Tests:

- New E2E `closing the player updates the library without a manual refresh`,
  which plays a book, closes the modal and asserts "Continue listening" appears,
  the grid never shows the loading placeholder, and the server agrees.
  **Verified it fails without the fix** (reverted the wiring, watched it fail
  with "Continue listening not found", restored) — a regression test that passes
  either way is worthless.
- Fixing this broke `resume-after-book-switch.spec.ts`: "Continue listening"
  renders a part-finished title as a heading a second time, so the spec's
  unscoped `getByRole("heading", { name: title }).click()` became a strict-mode
  violation ("resolved to 2 elements"). Fixed the helper with `.first()` and an
  `exact: true`, matching what the other two progress specs already did. The
  duplication is intended, so this is recorded in spec 14's acceptance criteria.

All green: server 38, client 53, Playwright 16 (was 15).

- `resume-after-book-switch.spec.ts` flaked once, on the full-suite run
  immediately following a `docker compose restart client` (cold Vite transform,
  so slow first paint). Three subsequent full-suite runs were clean and the spec
  passed 3/3 in isolation, so the likely cause is timing pressure from the cold
  client rather than a logic break — but it was only observed once, so treat it
  as unexplained if it recurs. `playwright.config.ts` has `retries: 1`, so a
  flake reports as "flaky" rather than failing the run.

**Earlier session 2026-10-06: spec 14 — listening position display — done.**

The server already remembered where each profile stopped (spec 04), but the UI
barely showed it: one progress bar spanning the whole book and an `m:ss` counter,
so "Chapter 4, 45 minutes in" and "38% through the book" had to be inferred by
arithmetic. The library grid showed nothing at all.

Research (Libby, Sora/OverDrive, Audible, Apple Books, Audiobookshelf) converged on
four things, all implemented:

1. **Book-level and chapter-level progress shown together, not instead of each
   other.** Audible and Audiobookshelf's Android app do this; Audiobookshelf's
   *web* player only offers one at a time and has an open request for both
   (advplyr/audiobookshelf#5440), which is why it is the differentiator here.
2. **Chapter boundaries drawn on the timeline** (Libby: "the timeline shows your
   progress, chapter breaks, ...").
3. **A marker at where this session began** (Apple Books draws "the point where
   you started listening ... marked with a gray circle"). Free here, since spec 04
   already tracks the session start.
4. **Do not rebuild the slider.** Keep the native `<input type="range">` and
   layer the decoration as `aria-hidden` + `pointer-events: none`. Recorded in
   `decisions/007-native-range-input-for-seek-control.md` so the redesign cannot
   quietly undo it.

What shipped:

- **`client/src/lib/position.ts`** — every position calculation, pure and
  DOM-free: `parseSegments`, `locateSegment`, `describePosition`, `chapterTicks`,
  `sessionMarkerFraction`, `timeLabel`, `remainingLabel`, `percentComplete`,
  `totalDuration`, `hasProgress`. 34 unit tests covering position 0, exactly on a
  chapter start, the last second of a chapter, past the final chapter, NaN,
  negative and `+Infinity`.
- **`client/src/components/ProgressTimeline.tsx`** — the native input plus the
  `aria-hidden` tick/marker overlay and the thinner chapter sub-bar. 9 render
  tests. Owns no position logic.
- **`ChapterPlayer`** — a readout line (`Track 7 — 07 - THE PREMATURE BURIAL`,
  `13:33 into this track · 34%`, `50% of the book · 2h 34m left`) and the
  session-start marker. Its duplicated local `timeLabel`/`parseSegments` were
  deleted in favour of the shared module.
- **`GET /api/audiobooks`** gains `progress: { position, completed, lastPlayed }`
  scoped to `x-profile-id`, resolved in **one** query for the whole library
  rather than one per book. Deliberately never 400s on a missing/malformed
  header, unlike `PUT /progress`: the library has to render before a profile is
  picked. 5 server tests cover that, plus profile isolation.
- **Grid** — a `Continue listening` section (most recently played first) and a
  progress line on part-finished cards in the main grid.

Deliberately **not** done, all logged in the spec's "Not in this spec":
bookmarks/highlights on the timeline (new data model), tick hover tooltips,
drag-to-scrub with a floating time bubble, and any visual polish. Spec 15 is the
GUI redesign and restyles this structure rather than rebuilding it.

Two bugs found and fixed while writing the tests:

- `locateSegment` mapped `+Infinity` to the *start* of the book while
  `describePosition` clamped the same value to the *end*. Now `+Infinity`
  clamps to the last segment; NaN and negatives still mean the start.
- `parseSegments` computed chapter duration as `end - start` with no guard, so a
  chapter whose `end` the scanner could not determine produced `NaN` and poisoned
  every later offset. Now falls back to the next chapter's start.

Validation:
- `server`: 38/38 (was 33).
- `client`: 53/53 (was 10) — 34 in `position.test.ts`, 9 in `ProgressTimeline.test.tsx`.
- Playwright: 15/15 (was 11) — new `e2e/position-display.spec.ts`.
- `tsc --noEmit` clean in both tiers.
- Live docker API confirmed: `progress` present with a profile header, `null`
  without one.

Gotcha hit during this session: the Vite dev server in docker missed the
`ChapterPlayer.tsx` edit over the bind mount and the E2E ran against stale code
(same watcher problem the older session notes describe). `docker compose restart
client` fixed it. Same applies after any client edit before running Playwright.

**Earlier session 2026-10-03: resume bug fully fixed and covered by tests.**

Continued from the previous session, which had the client-side fixes in
`6b4e861` but left the E2E failing. Everything is now green.

Root causes closed off in this session:

- **Client: the restore race had several more arms.** `ChapterPlayer.tsx` in
  this change is mostly the player hardening:
  - `userInteractedRef` — once the listener plays, seeks or picks a chapter, a
    late-arriving restore fetch can no longer override their choice.
  - `switchingSourceRef` — the synthetic `pause` from `audio.load()` is
    ignored for one tick, so swapping tracks cannot be read as the user
    pausing and cannot record a position in the track that was never played.
  - `desiredTimeRef` + `desiredTimeLockedRef` + an `onSeeked` handler — a
    cross-track seek survives the outgoing track's stray `timeupdate` and its
    `loadedmetadata`/`seeked` events. Previously an event belonging to the
    source being left consumed the pending seek, so playback restarted at the
    top of the incoming track and the saved position collapsed to that track's
    start offset.
  - `onLoadedMetadata` ignores events for a `currentSrc` other than
    `activeSrcRef`, and re-asserts a locked seek that a redundant `load()`
    discarded (React StrictMode runs the source effect twice).
  - The unmount cleanup refuses to save when a restore is still in flight and
    no session is open, and refuses to save position 0 from a player that
    never played — that combination is what wiped the stored position under
    StrictMode's mount/unmount/mount.
  - Chapter books now locate the position by range
    (`offset <= position < offset + duration`) instead of subtracting
    durations and re-adding the offset, which overshot by the offset itself.
  - Progress and session flushes are `keepalive: true`, and a
    `visibilitychange` to hidden flushes too (mobile browsers do not reliably
    fire `pagehide`, and the tab can then be frozen or discarded).
  - `flushSession` reads the rate from `speedRef` so a session records the
    speed the listener chose, not whichever value was current when the handler
    registered; the Media Session pause action now clears `shouldPlay`.
- **Duplicate resume rows (server).** `PUT /api/audiobooks/:id/progress` did
  `findFirst` then `update`/`create`. The periodic saver, the pause saver and
  the unmount saver could all observe "no row yet" and each create one, so
  `GET /progress` (which used an unordered `findFirst`) returned an arbitrary
  row and resume flip-flopped. Fixed by a DB-level
  `@@unique([mediaItemId, profileId])` (migration
  `20261005000000_listening_history_unique_position`) plus a Prisma `upsert`,
  and the read is now ordered by `lastPlayed desc`. The migration deletes all
  but the most recently played row per pair first, so it still applies to a
  database that already accumulated duplicates (verified against a synthetic
  DB with duplicates).
- **Out-of-range values persisted.** Progress is now clamped into
  `[0, duration]` only when the duration is known, and falls back to
  `max(0, value)` otherwise; a non-finite value resets to 0 instead of being
  stored. `completed` is only auto-derived when a duration exists (previously
  `0 >= 0.95 * Infinity` marked every unknown-length book as finished).
  `POST /sessions` clamps `fromPosition`/`toPosition` into the book and caps
  `speed` at 10x with a 1x fallback.
- **`GET /api/audiobooks/abc` returned 500.** `Number("abc")` is NaN and Prisma
  500s on it. It now uses `parseIdParam` and returns 400, matching the other
  id routes.
- **Deleting the active profile left the app stuck.** `ProfileSwitcher` kept
  the deleted id in state, so the profile gate never reappeared and every
  progress save was silently rejected with 400. It now reloads, like selecting
  a profile does.

Test coverage added:

- `server/src/progress.test.ts`: 8 concurrent PUTs create no extra row and the
  read-back equals one of the written values; non-numeric id → 400; session
  bounds/speed clamping and speed fallback.
- `client/src/components/ChapterPlayer.test.tsx`: no save on unmount when
  playback never started (the StrictMode mount/unmount/mount case); the saved
  position is restored to the right book; no zero re-save after restoring; a
  cross-track seek lands on the requested offset in the new track.
- `e2e/resume-after-book-switch.spec.ts` (new): the real reported scenario —
  seek book A to 3:00, play ~1s, close, play book B for ~1s, reopen A. Asserts
  the server-side position after closing A, that the B detour does not disturb
  it, and that pressing play resumes within 3m ± 30s. 300s timeout.

E2E reliability work (the previous run's "still fails" note was mostly bad
harness hygiene, not app bugs):

- `e2e/global-setup.ts` (new) + `playwright.config.ts`: fail loudly when the
  servers, the `test/` fixtures or `APP_PASSWORD` are missing, instead of
  letting every test skip into a vacuous green run. Timeout 30s → 90s, single
  worker, `serviceWorkers: "block"`.
- `e2e/helpers.ts`: `ensureAuthed()` polls the API before any helper touches it
  (a `Set-Cookie` can land after the UI re-renders, producing phantom 401s);
  `pickAnyProfile()` replaces hardcoded seeded names; `deleteProfiles()` cleans
  up leftovers and reloads so the profile gate sees the change.
- `e2e/progress-resume.spec.ts`: numeric slider comparisons (a range input over
  float offsets can fail on string-exact `1800`), books chosen by unique title
  and long enough for the seek target, `input` event only (adding `change`
  ran the handler twice), scoped heading lookups to the grid.
- `e2e/security/security.spec.ts`: shared `ensureScannedLibrary()` that reuses
  an existing library or scans a fixture path, asserts the 416 `content-range`,
  and hits real book ids so the payload tests don't pass on a 404.
- `docker-compose.yml`: sets `APP_PASSWORD` (default `household`) — the
  security suite's 401 assertions are vacuous without auth enabled.

Validation from this session:

- `cd server && npm test` — 33/33 pass.
- `cd client && npm test` — 10/10 pass; `npx tsc --noEmit` clean.
- `npx playwright test` (chromium + security) — 11/11 pass.
- Live docker server: 8 concurrent PUTs against the running API left exactly
  one `ListeningHistory` row, and the read-back was one of the written values.

Notes for the next session:

- The previous session's "browser resume test still fails" item is **closed**;
  spec 04's browser acceptance can be treated as met.
- Historical audit findings for `@fastify/static`, `vitest`, and `esbuild` were
  addressed in the 2026-10-24 security refresh; current audits report zero
  vulnerabilities.
- The compose dev server uses `prisma db push`, so `prisma migrate status`
  reports all migrations as unapplied against that database. That is expected;
  the migration matters for `Dockerfile.prod` (`migrate deploy`).
- Added trailing newlines to four files the diff had left without one.

**Earlier session 2026-10-02 (late): playback resume when switching books.**

User reports that seeking well into a book, opening another book, then returning
to the first resumes at the beginning. Reviewed this handoff, `specs/04-progress-listening-history.md`,
the progress routes, `ChapterPlayer`, and existing resume tests.

Completed in this continuation:
- Found a client-side teardown bug in `client/src/components/ChapterPlayer.tsx`:
  the unmount cleanup read `audioRef.current`, but React clears the ref before
  passive cleanup runs. The cleanup therefore skipped its final progress PUT
  when the detail modal closed/book changed.
- Changed teardown to capture the audio element while mounted and calculate
  the final position from `audio.currentTime` plus the active track offset.
  `currentIndexRef` keeps the active track index current without relying on a
  stale effect closure.
- Added a component regression test for seeking to 1800 seconds and immediately
  unmounting. Focused test passes: 3 tests in `ChapterPlayer.test.tsx`.
- Added an E2E test to `e2e/progress-resume.spec.ts` for seek to 30 minutes,
  switch to a second book, then reopen the first and verify persistence.
- Fixed another resume race: seeking before the active track's source was
  switched could be lost by `audio.load()`. Restore now defers the seek until
  metadata for the new track arrives.
- Updated React's displayed position when applying a restore seek, since
  assigning `audio.currentTime` while paused does not emit `timeupdate`.
- Prevented source changes from overwriting saved progress with zero: browsers
  can emit a synthetic `pause` while setting/loading a source, so pause saves
  now require an active listening session.
- Added an API response check to the resume E2E and a tolerance for fractional
  media duration math.

Still unresolved at the time (all closed in the 2026-10-03 session above):
- The focused browser tests still failed: although the test's direct progress
  PUT returned `{ position: 500 }`, the reopened player's slider remained at 0.
  Root cause was the duplicate-resume-row race plus phantom 401s in the
  harness, not the client.
- The server/client networking issue is resolved for tests: WSL can reach the
  API through `VITE_API_URL=http://localhost:3000`; the 401 from direct shell
  curls was expected because they omitted the household cookie.
- Temporary response logging has been removed. Spec 04's browser acceptance is
  now met.

Current validation (as of the end of that session):
- `client`: `npm test -- --run src/components/ChapterPlayer.test.tsx` — pass,
  3/3 tests.
- `get_errors` on the touched player and test files — no errors.
- `e2e`: superseded by the 2026-10-03 run (11/11 green).

Working environment:
- Backend is responding on `http://localhost:3000` (health check passed).
- Client dev server is running on `http://localhost:5173` with
  `VITE_API_URL=http://localhost:3000`; if it stops, start from `client/` in
  WSL with `export PATH=/home/benle/node/bin:/usr/local/bin:/usr/bin:/bin`
  and `export VITE_API_URL=http://localhost:3000` before `npm run dev -- --host 0.0.0.0`.
- For tests from WSL, use the clean PATH above; inherited Windows PATH entries
  contain spaces/parentheses and can break shell expansion.

**Session 2026-10-02 (evening): fixed the two user-reported bugs.**

Done this session:
- **Playback resume (issue 1).** Root causes found and fixed:
  1. With no profile selected, every progress GET/PUT got 400 and the
     client swallowed it — nothing was ever saved or restored. Fix:
     `ProfileGate` (client) now forces a profile pick (or creation)
     before the app renders, per spec 03; `ChapterPlayer` also blocks
     play with an inline hint if localStorage loses profileId.
  2. The 10s periodic save had `[playing, overallPosition]` deps, so
     the interval restarted on every position tick and never fired.
     Fix: deps `[playing]` + read position from `overallPositionRef`.
  3. (Carried over from prior uncommitted work: restore-seek race fix
     via readyState check; save progress on unmount.)
- **Duplicate profile names (issue 2).** `Profile.name` is now `@unique`
  (migration `20261002200000_profile_name_unique`), POST /api/profiles
  returns 409 on duplicates, client shows an error. Live dev DB was
  deduped (had 4× "E2E User") and the migration applied.
- **Household profiles seeded.** `server/src/seed.ts` (shared list:
  Dad, Mum, Archie, Ben, Playwright, Testing) + `npm run seed:profiles`
  script + auto-seed in `server/src/index.ts` on first boot of an empty
  DB (verified against a fresh DB). Live DB seeded.
- **Tests.** Server 29 green (new: duplicate profile name → 409).
  Client 5 green, `tsc --noEmit` clean (new: ChapterPlayer gating).
  Playwright 9 green (chromium + security). New
  `e2e/progress-resume.spec.ts` (save position via API → reopen book →
  seek bar at saved position). `e2e/helpers.ts` login() now waits for
  the gate (was racing the auth probe); added `pickProfile()` helper.
  e2e specs clean up their test profiles before AND after so runs are
  idempotent against the shared throwaway DB.
- **Specs updated:** 03 (unique names, profile gate, seeding) and
  04 (periodic-save behaviour, profile requirement) checklists.

Remaining follow-ups:
- Verify M4B chapter extraction against a real M4B via docker (no ffprobe
  on the WSL host).
- Replace SVG PWA icon with real raster icons; run Lighthouse PWA audit.
- Spec 09 APK build needs Android SDK (user machine).
- Spec 13 media tools are deferred unless the user asks for them.
- Commit + push from the user's terminal (owner pushes manually).

### Environment notes (important for a fresh session)
- No system Node: use `export PATH=$HOME/node/bin:$PATH` (Node v24.22.1).
- Dev servers were restarted this session and are running in the
  background: server :3000 (APP_PASSWORD=household, DATABASE_URL=
  file:/tmp/audiobook-e2e.db, COVER_DIR=/tmp/covers) and client :5173
  (VITE_API_URL=http://localhost:3000). Logs: /tmp/server.log,
  /tmp/client.log. If session lost: restart both before running E2E.
- **WSL gotcha:** the vite dev server's file watcher misses edits made
  over /mnt/c — if client changes seem not to take effect, restart
  `npm run dev` in client/ before debugging the code.
- Test commands: `cd server && npm test` (290 tests), `cd client &&
  npm test` (104 tests) + `npx tsc --noEmit`, `npx playwright test`
  (or `--project=security`) from repo root. Playwright has a
  `globalSetup` that aborts with an actionable message if the servers, the
  `test/` fixtures or `APP_PASSWORD` are missing.
  Counts in the historical session entries below are point-in-time for the
  session they describe; the live numbers are in "Current state".
- Playwright chromium system deps installed by the user via sudo.
- `e2e/` flows need the dev servers up; server DB is throwaway at
  /tmp/audiobook-e2e.db with collected sample media from `test/`.
  e2e profiles (E2E User / E2E Dup) are created and cleaned by the
  specs themselves; the six household profiles persist.

## Open questions / blockers

- **Passkey offline data boundary:** a passkey signs in online but does not unlock the password-wrapped offline key. The user enters the profile password on the offline unlock screen when they need private saved data; this is the spec approach, and the older open-question note is resolved.
- **Migration rehearsal target.** Phase 8 needs a copy of the live
  `audiobook.db`; confirm with the owner before copying it, and check
  `Playwright`/`Testing`/`Archie` and each profile's library afterwards.
- None blocking otherwise. Decisions deferred to the user: Android APK build
  (spec 09), M4B verification environment, media tools (spec 13).

## Suggestions for next sessions

- **Next: validate production Compose/Caddy, run Playwright and build checks, then complete the Windows CA/Hello and Pixel/Defy biometric flows plus migration rehearsal.**
  The Pixel 4a now has the debug app; enrollment needs the server online and a
  profile sign-in before the biometric prompt can be exercised. The suites,
  Android build and copy check were run on 2026-10-24. Playwright reached 44
  passes; one smoke check failed because its persistent database already had
  library books, and six tests passed only after retry. The Android interaction
  was not yet performed.
- Consider a server-side `DELETE /api/profiles/:id` guard so the currently
  selected profile can't be deleted from under the user. The client now
  reloads on delete, but other devices (or a stale localStorage) can still
  point at a deleted row and get silent 400s on every progress save.
- Security audit refresh (2026-10-24): clean installs/audits, all unit suites, builds, and 10/10 security E2E checks passed on Node 24.22.1. Dependency audit automation and weekly Dependabot updates now cover root, server, and client. HTTP on the household LAN remains the documented security gap.
- ~~**Spec 15 (GUI redesign) is next**, and has no spec file yet~~ — **done
  2026-10-18.** `specs/15-gui-redesign.md` exists, the redesign landed, and
  `DESIGN.md` records the built system. 15b is done; spec 28 is the current
  work. Position-display ideas still unbuilt, in rough priority order: tick
  hover tooltips naming the chapter, a drag-to-scrub time bubble, and
  bookmarks/highlights on the timeline (the last one needs a new data model).
- **Chapter editing UI.** Spec 21 shipped the
  `PUT /api/audiobooks/:id/tracks/:trackNumber/title` endpoint but no editor,
  so a user cannot yet set a track title by hand. Spec 06 deferred the editor;
  the endpoint and the `FieldOverride` storage are what it should be built on.
- `server/src/scripts/scan.ts` (package.json "scan") doesn't exist — either
  add it or drop the script (known quirk, harmless).
- If the household grows, the seeded profile list in `server/src/seed.ts`
  is the single place to edit; existing DBs won't gain new defaults until
  `npm run seed:profiles` is run manually (by design — deletions stick).

## Known bugs / quirks discovered while reading code

- `server/src/services/scanner.ts` used `prisma.contributor.upsert({ where: { id: 0 } ...})`
  (always created a new row) — **fixed in spec 01**: upsert by (name, role) + unique.
- Line endings: one commit normalized CRLF on ~30 files (cosmetic, harmless).
- `server/src/scripts/scan.ts` referenced by package.json "scan" script does
  not exist — see package.json "scan" script; never runs unless invoked.
- **Fixed (2026-10-02 session):** progress was silently lost when no profile was
  selected (400s swallowed by the client) — now gated by ProfileGate.
- **Fixed (2026-10-02 session):** the 10s periodic progress save never fired (its
  interval was reset by every position tick) — now keyed on `playing` only.
- **Fixed (2026-10-02 session):** duplicate profile names were possible pre-migration;
  live DB had 4× "E2E User" — deduped, unique index applied, 409 on dupes.
- **Fixed:** `e2e/helpers.ts` login() raced the async auth probe
  (checked for the password box before it rendered) — now waits up to 3s.
- **Fixed (resume session):** concurrent progress saves created duplicate
  `ListeningHistory` rows per (book, profile), so resume read an arbitrary one
  — unique index + `upsert`, read ordered by `lastPlayed`.
- **Fixed (resume session):** `completed` was auto-set to true for every
  unknown-duration book (`position >= 0.95 * Infinity`) — only derived when a
  duration is known.
- **Fixed (resume session):** `GET /api/audiobooks/abc` 500'd via NaN into
  Prisma — now 400 via `parseIdParam`.
- **Fixed (resume session):** deleting the active profile left the client
  holding a dead id, so every progress save silently 400'd — now reloads.
- **Fixed (resume session):** E2E helper calls raced the auth cookie, so
  `page.request` calls intermittently 401'd — `ensureAuthed()` polls first.
- **Fixed (resume session):** a cross-track seek was consumed by the outgoing
  track's `loadedmetadata`/`seeked`, so playback restarted at the top of the
  incoming track — pending seeks are now source- and lock-aware.
- **Fixed (resume session):** chapter books resolved a resume position by
  subtracting track durations, overshooting by the chapter offset.
- **Fixed (resume session):** a backgrounded mobile tab lost its last seconds
  of progress — flushes are `keepalive` and also fire on `visibilitychange`.
- **Fixed (spec 14 session):** `locateSegment` mapped `+Infinity` to the start of
  the book while `describePosition` clamped it to the end — now both clamp to
  the last segment.
- **Fixed (spec 14 session):** chapter duration was `end - start` with no guard,
  so a chapter the scanner could not bound produced `NaN` and poisoned every
  later offset — now falls back to the next chapter's start.
- **Fixed (spec 14 follow-up):** the library grid never refetched after
  playback, so saved progress never appeared — the shell now refetches when the
  player's final save resolves, and on window focus / tab visible.
- **Fixed (spec 21):** the Audnexus provider had **never worked** — wrong host
  (`audnex.us` not `api.audnex.us`) and no book-search endpoint exists at all.
  Every request 404'd since spec 16, and silent degradation hid it. Now an
  ASIN-keyed lookup only; see ADR 011.
- **Fixed (spec 21):** an `EnrichmentRun` enqueued while another was in flight
  sat at `pending` forever — the `running` guard returned early and nothing
  revisited it.
- **Fixed (spec 21):** "a user-set track title is never overwritten" was
  checked off but enforced by nothing; the lock lived in an option no caller
  passed. It now lives in `FieldOverride` and is read inside
  `applyChapterTitles`.
- **Note (spec 21):** the scanner `deleteMany`s and recreates every `Track` row
  on each rescan, and reassigns track ids. Anything that must survive a rescan
  has to be keyed on `MediaItem` (e.g. `FieldOverride`), never on `Track`.
  Chapter titles are also reset to the embedded tag by every scan, so run
  `make enrich` (force) after `make scan`.
- **Note (spec 14 session):** the Vite dev server in docker silently misses edits
  made over the `/mnt/c` bind mount. Restart the client container before
  concluding a client change "does nothing".
- **Note (spec 14 follow-up):** a part-finished book's title is now a heading in
  two places (Continue listening + All audiobooks). Any E2E locator by heading
  name must be scoped (`.first()`, or scoped to a section) or it hits a
  strict-mode violation.

## How to resume after a dropped session

1. Read `roadmap.md` for the plan; read this file for current position.
2. `git log --oneline -5` and `git status` to see what landed.
3. Continue the "Current task" section; update this file before ending.

---

## User-reported issues — investigation (2026-10-26)

### 1) No fingerprint prompt on Pixel 4a (spec 28, phase 5)

**Finding: working as designed, gated on device state — not a code bug.**

The biometrics button in `AccountGate.tsx` (line 411) renders only when all three are true:

| Condition | What it requires |
|-----------|------------------|
| `biometricsAvailable` | `biometricVault.available()` → Android `BiometricVaultPlugin.isAvailable()` → `BiometricManager.canAuthenticate(BIOMETRIC_STRONG) == BIOMETRIC_SUCCESS`. Needs biometric hardware **and** at least one fingerprint/face enrolled at the Android OS level, and not locked out by device policy. |
| `mode.account.hasDeviceUnlock` | Server `GET /api/auth/accounts` → `profile._count.deviceCredentials > 0`. The profile must have a device credential enrolled in the app. |
| `isNativeShell()` | Running inside the Capacitor APK, not a browser/PWA. |

The enrollment chain:
1. Settings → "Fingerprint or face" section ("Enable fingerprint or face") only renders when `biometricVault.supported() && available` (`DeviceUnlockSettings.tsx` line 64). If `available()` is false, the section never appears.
2. Enrolling POSTs to `/api/auth/devices` (server creates a DeviceCredential, stores only its SHA-256 hash) and saves `{ profileId, secret, DEK }` to the biometric Vault. After that `hasDeviceUnlock` becomes true.
3. `AccountGate` then shows "Unlock with fingerprint or face".

On the Pixel 4a the user never saw any biometrics setting. Most likely cause: **no fingerprint is enrolled at the Android OS level**, so `canAuthenticate(BIOMETRIC_STRONG)` returns `BIOMETRIC_ERROR_NONE_ENROLLED`, `available()` is false, and both the Settings section and the AccountGate button stay hidden. Alternative: they are testing in a browser/PWA rather than the installed APK (`isNativeShell()` false), but USB-tunnel use suggests the APK.

This matches spec 28's designed behavior: "cancelling falls back to the password"; "an unavailable sensor… falls back to the password screen". Password is always the fallback.

**What the user needs to do:**
- Enroll a fingerprint in Android Settings (Security → Fingerprint) on the Pixel 4a.
- Open the app's Settings → "Fingerprint or face" → "Enable fingerprint or face" (this requires a signed-in profile and a reachable server).
- After enabling, `AccountGate` will show "Unlock with fingerprint or face".

**Possible UX improvement (not yet built):** when biometrics is unavailable, show a hint like "Enroll a fingerprint in Android Settings to use it here" instead of silently hiding the control. No code change made yet — ask the user before adding.

### 2) WiFi does not detect the server; only USB tunnel works (Pixel 4a)

**Finding: there are two independent gates.** The app must permit HTTP LAN
requests, and the WiFi must permit devices to reach one another.

Both phones are on Cisco AP `toob-9F4CE1` (192.168.1.0/24, normal DHCP lease) with **client isolation**: every packet to another device is blackholed. The router and host answer nothing; connections to port 3000 *hang* rather than being refused. The host firewall *does* allow inbound TCP 3000 from the local subnet. `http://192.168.1.203:3000` works from a laptop on the LAN but not from either phone.

The only route measured from a phone to the server on this AP is
`adb reverse tcp:3000 tcp:3000` (USB tunnel). The app has no server
auto-discovery — the URL is manually configured in Settings — and even with
the correct URL configured, client isolation blocks the connection.

**App-side configuration:** retain Capacitor's default `https://localhost`
origin to preserve localStorage and IndexedDB, and set
`android.allowMixedContent = true` for the HTTP LAN API. The earlier
`androidScheme: "http"` workaround changed the storage origin and hid the
existing downloaded-book catalogue. See ADR 014 and LIMITATIONS 1.6.

The current report says the phone is on WiFi, but whether it can reach the
server from that network is unverified. The older measurements found client
isolation on `toob-9F4CE1`; test the updated app on a network that permits
device-to-device traffic before concluding the WebView fix failed. This work
has not been installed or tested on a phone.

If the phone still cannot reach the server from that SSID, put both devices on
the main SSID or disable client isolation on `toob-9F4CE1`. Do not work around
AP isolation with mDNS discovery; that is outside spec scope.

**Storage recovery decision (2026-10-27):** the owner confirmed that the
downloads to preserve were saved before the HTTP-origin change. The Android
config has therefore returned to Capacitor's default HTTPS origin and enables
mixed content for the configured LAN server. Data written under the interim
HTTP origin remains separate. Rebuild and install are still required; no phone
was attached for this change.

---

## Action needed from the owner

- Confirm the Pixel 4a fingerprint enrollment status (Android Settings → Security → Fingerprint).
- Decide whether to add the biometrics-unavailable hint UX improvement.
- Confirm whether they want to pursue the WiFi fix on the household network (main SSID / AP client isolation).

Owner stages, commits and pushes changes. Committed as `b4ee251` on `master` — Settings icon changed from `BookOpen` to `Settings` (gear) in `client/src/App.tsx`; `tsc --noEmit` clean; all 416 client tests pass (35 files). APK built (`./gradlew assembleDebug`) and installed on Motorola Defy (`ZY32D8WLXM`, Android 11) via `adb install -r`; app launched successfully.
