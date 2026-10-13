# Spec 26 — Android app with offline listening

## Purpose
The product targets commercial audiobooks and the household needs to listen
**away from home**. Today that is impossible: the PWA caches no API responses
and the Capacitor wrapper points at the server URL, so without the server the
app is inert.

Scope changed in response to user feedback: the app must be usable off-network,
on Android, sideloaded.

Architecture rationale is in
[`decisions/012-device-is-a-player-not-a-library-manager.md`](../decisions/012-device-is-a-player-not-a-library-manager.md).
This spec narrows roadmap item 09, which assumed a thin wrapper pointing at the
server URL.

## Confirmed decisions

- **Android only.** iOS is explicitly not a requirement; nobody in the household
  owns an Apple device, so it could not be tested anyway.
- **Sideloaded APK** is acceptable. No Play Store.
- **Metadata is a read replica.** Tags, genres, series, contributors and
  chapters must be *readable* offline once a book is downloaded. Editing and
  enrichment remain server-only, so a metadata conflict cannot arise.
- **One book at a time.** No download queue, no resumable background
  transfers — serve the files over the LAN.
- **Users cannot manage device storage.** A clear "remove book from device"
  action is required.
- **Listening is one device, one book, one profile** for most sessions.

## Progress merge rule

Chosen with the user after the first proposal was found to lose data. The
rejected alternative was "latest `lastPlayed` wins", which fails when a phone
dies offline, another device gets further ahead, and the phone later reconnects
and overwrites the newer position.

**Progress never silently regresses. Timestamps are not used for correctness.**

| Situation | Behaviour |
|---|---|
| Forward push | Applied silently. Never prompts. |
| Backward by ≤ 5 minutes | Applied silently — genuine re-listening |
| Backward by > 5 minutes | **Blocked**, server returns its authoritative row, client prompts |
| "Restart book" / "Mark as finished" | Always explicit |

The conflict dialog names the actual positions:

> **This book is further along elsewhere**
> Another device is at **2h 14m**. This device is at **1h 30m**.
> `[ Keep 2h 14m ]` (default)  `[ Use 1h 30m ]`

**"Use 1h 30m" is a single tap and is itself the confirmation** — no second
prompt, per the user's decision. It is the destructive option, so the safe
choice is the default and holds focus.

### Server contract

`PUT /api/audiobooks/:id/progress` gains an optional `allowRewind: boolean` and
always returns the authoritative row.

- forward, or backward ≤ 5 min → applied
- backward > 5 min without `allowRewind` → **clamped to current** and the server
  row returned; the client prompts on seeing a clamp
- with `allowRewind: true` → applied

Clamping rather than erroring keeps client and server from diverging: the
client adopts whatever came back.

Because the rule is monotonic, **clock skew stops being a correctness problem**.
A phone five hours fast that pushes forward is accepted (it probably *is*
further); one that pushes backward is asked about instead of silently applying.

This applies to **every client**, including the PWA — a buggy client or a stale
tab cannot wipe a bookmark.

### Accepted trade-off
A 5-minute threshold means "rewind ten minutes, then pause" can prompt. It only
fires when the device is still behind at write time; listening forward again
past that point makes the next write forward and silent. The user accepted this
in preference to silently losing hours of progress.

## Build and test toolchain

### Target device
Testing is on a **physical Android phone running Android 13**. That is
deliberate: Android 13 is where media sessions must be properly declared and
where browsers get deprioritised for background audio. If playback survives
there it survives on 14 and 15, so it is the strictest useful target.

### What to install

| | Size | Needed |
|---|---|---|
| Android Studio | ~1.2 GB | Recommended — bundles SDK, JDK and adb, and accepts SDK licences |
| SDK platform + build-tools | ~1–1.5 GB | Yes, installed by Studio |
| Gradle + Android Gradle Plugin | ~0.5–1 GB | Downloaded on first build |
| **Emulator + system image** | +1.5–2 GB | **No.** Also needs Hyper-V, and is a poor proxy for real background-audio behaviour |

The build runs on Windows natively, not in WSL. WSL is only used for Docker
(server + Playwright).

### Build pipeline

```bash
cd client
npm run build          # tsc -b && vite build -> client/dist
npx cap sync android   # copies dist/ into android/app/src/main/assets/public/
cd android
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

- **Debug APKs are auto-signed** with the debug keystore, so sideloading needs no
  signing setup. A real keystore is only needed for a release build.
- The first Gradle run downloads Gradle and the AGP (~0.5–1 GB) and is slow.
  Every build after that is seconds.
- **`npx cap add android` overwrites `client/capacitor.config.ts`**, dropping the
  hardcoded `server.url`. That is a change we want anyway (Phase 4 replaces it
  with an in-app setting), but it will show as a diff.

`client/android/` is **generated but committed** — it is where the Android
manifest (permissions, foreground service) and Gradle config are edited by hand,
so it is source, not a build artifact.

Build commands are scripted as `npm run android:sync` and `npm run
android:build`, because the spike rebuilds constantly.

### Testing strategy

| Layer | Tool | Needs a device? |
|---|---|---|
| Sync engine, progress merge, Dexie queries | Vitest in the existing client suite, plus `fake-indexeddb` | No |
| Offline browse, search, conflict dialog | Vitest + RTL, existing setup | No |
| Offline end to end — download, `setOffline(true)`, replay, sync | Playwright, existing suite | No |
| Native layer — filesystem, local audio, foreground service | **Manual checklist** | Yes |

**Only the native behaviours are manual.** Everything else is automated,
because the same code runs in Chromium.

**Risk to resolve early:** the Playwright suite currently runs against the dev
server inside Docker over WSL. `setOffline` and IndexedDB assertions may fight
that harness and need a separate Playwright project or a host-side run. Find out
in Phase 2, not Phase 3.

Automated phone-driving (Appium, Detox) is **deliberately not used**: heavy,
flaky, and it mostly tests Android rather than this code.

### Manual checklist — kept short deliberately

This is re-run constantly during the spike, so it targets minutes, not hours.
Android kills a misconfigured media session within seconds of the screen going
off, so a short wait is enough to detect failure; a longer one only adds
battery-management edge cases.

| # | Check | Expected | ~time |
|---|---|---|---|
| 1 | Play the downloaded book from local storage | audio plays | 15s |
| 2 | Seek to the middle of the file | lands there, audio continues | 15s |
| 3 | **Lock the screen, wait 5 minutes** | still playing; position advanced | 5 min |
| 4 | Enable airplane mode, keep playing | uninterrupted | 30s |
| 5 | "Remove from device" | space freed; server copy untouched | 30s |

**~7 minutes per run.** Anything slower gets automated or cut.

### Distribution

The finished app is a single APK copied to household phones: enable "install
from unknown sources", tap, "Install anyway".

**Updates are manual** — every release means redistributing and reinstalling.
If that becomes a chore, Capacitor live-update (host `dist.zip`, swap assets on
launch) covers almost all changes, since the logic is web code. A Phase 4/5
consideration, not a spike dependency.

## Behaviour

- Download a book over the LAN; audio and its metadata are stored together.
- Playback reads the local file; falls back to streaming when a book is not
  downloaded and the device is online.
- Library browsing, search, genres, series, tags and chapter navigation all work
  offline for downloaded books.
- Progress syncs on reconnect and never regresses silently.
- A "downloaded on this device" list shows sizes and offers **Remove from
  device**, with a clear low-space path.
- A settings screen sets the server URL. This replaces the hardcoded
  `localhost:3000` and is also what solves DHCP-assigned IP changes.
- Discover states it needs a connection, as it already does.

## Acceptance criteria

- [ ] An installable APK sideloads onto an Android device.
- [ ] **Spike proven first:** audio plays from a local file with the screen off
      for 5 minutes, and seeks correctly within a file.
- [ ] A downloaded book plays with the network off.
- [ ] Its genres, tags, series and chapters are visible offline.
- [ ] A book not downloaded still streams while online.
- [ ] "Remove from device" frees space and leaves the server copy untouched.
- [ ] Server URL is configurable in-app without rebuilding the web bundle.
- [ ] Forward progress sync applies silently.
- [ ] Backward progress beyond 5 minutes prompts with both positions named, and
      neither button silently overwrites.
- [ ] The prompt is suppressed when the sync is not a regression.

## Phases

| # | Phase | Note |
|---|---|---|
| 0 | `LibraryStore` read-model seam on the server | Server-only, no user-visible change. Reviewed on its own despite no standalone payoff. |
| 1 | **De-risk spike** | Capacitor → download one file → play → seek → screen off. If this fails, the architecture changes and we want to know before Phase 2, not after |
| 2 | Dexie replica + offline browse | Satisfies the offline-metadata requirement |
| 3 | Progress sync with the monotonic merge and conflict dialog | |
| 4 | Storage management UI + settings screen | Settings also kills the hardcoded server URL |

## Risks, ranked

1. **Background audio with the screen off.** Make-or-break. Android 13+ requires
   a foreground service with `mediaPlayback`. Proven in Phase 1 or not at all.
2. **Seeking on local file URLs in a WebView.** Historically flaky. Same spike.
3. **Sideloading means manual updates** — reinstalling APKs across a household.
   Self-hosted auto-update is the fallback if it becomes a chore.
4. **App-private files are invisible** to the Files app.

## Not in this spec

- Offline editing, enrichment, scanning or Discover.
- Download queues, resumable background transfers, whole-library sync.
- iOS.
- MediaStore integration for user-visible files.
- Play Store publishing.