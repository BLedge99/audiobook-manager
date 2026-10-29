# Spec 29 — Offline resilience: no dead ends, no false claims

## Purpose

Downloading a book is a promise: it will play with no network. Three separate
failures broke that promise in ways that looked like data loss, and one of them
made the app unusable until it was force-quit:

1. **The unlock screen had no exit.** A device with downloads whose saved
   fingerprint key had been invalidated (enrolling a new fingerprint does this
   on Android) could neither unlock with the fingerprint nor with a password,
   and nothing on the screen was actionable.
2. **"Nothing has been downloaded" was shown for libraries that could not be
   read.** A replica read failure was swallowed and rendered as an empty device,
   so a phone full of audio looked empty.
3. **Audio files outlived their database rows.** Moving the WebView origin left
   gigabytes under `books/` with nothing describing them. The files were there;
   the app could not see them and had no way to re-adopt them.

This spec replaces the offline decision ladder with one tested table and adds
the two escape hatches and one recovery path. The rule it encodes:

> **Being unable to reach the server never dead-ends, and the app never claims
> something it cannot prove.**

Written before the code, per `AGENTS.md`. Implementation: `client/src/lib/offlineGate.ts`,
`client/src/lib/biometricFailure.ts`, `client/src/local/recover.ts`, `client/src/App.tsx`,
`client/src/components/OfflineUnlock.tsx`.

## Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Offline, cache cannot be proven | Show the unlock screen, but always offer **Change server address** and **Listen without progress** |
| 2 | Saved fingerprint key unusable (non-cancel) | Clear it, explain once, continue on the password path |
| 3 | Audio files with no library record | Detect and offer one-tap recovery, where the loss is felt (the shelf) |
| 4 | Device library cannot be read | Say the audio may still be here; **Try again** re-reads the server *and* the device library |
| 5 | Continue offline on the address screen | Always available in the native shell, even with nothing loaded |
| 6 | Offline with nothing downloaded | Enter the app: Library tab only, honest empty state |
| 7 | Recovery while the server is unreachable | Detect, promise restore when reachable, keep the files untouched |
| 8 | Biometrics unavailable | Explain in both Settings and the sign-in screen |
| 9 | Listen without progress | Allowed, with a persistent "progress is not being saved" line, no repeat prompting |
| 10 | Reconnect | A skip lasts for the offline session; reconnecting re-offers the key by resetting the skip |

Related: [`decisions/018-offline-cache-is-provable-two-ways.md`](../decisions/018-offline-cache-is-provable-two-ways.md),
[`specs/26-android-app.md`](26-android-app.md) (offline section),
[`specs/28-accounts-passkeys-biometrics.md`](28-accounts-passkeys-biometrics.md) (biometrics and the cache).

## Behaviour

Offline means `serverReachable === false`. The app asks the server once; a failed
request re-probes, and the probe alone decides.

### The offline screen table

`offlineScreen()` in `client/src/lib/offlineGate.ts` is the whole branch. The
order of the checks is the meaning:

| Condition (first match wins) | Screen |
|---|---|
| `deviceLoading` | `Splash` — the app does not yet know what it holds |
| `libraryReadError !== null` | `OfflineNotice` with `libraryReadFailed`: "couldn't read its on-device library… the audio may still be here"; **Try again** re-probes *and* re-reads; **Change server address** |
| books > 0 **and** profile known **and** cache `present` **and** not unlocked **and** not skipped | `OfflineUnlock` with fingerprint (when a saved value exists), **Change server address**, **Listen without progress** |
| cache `unknown` while an unlock is otherwise wanted | `Splash` — never flash an unlock that may be unnecessary |
| everything else | app shell; `progressAvailable = unlocked` |

Two consequences that are easy to get wrong:

- **Nothing downloaded never yields `unlock`.** A phone with no books gets the
  shell and an empty state, not a password prompt for nothing.
- **`cache: "absent"` never walls anyone out.** It yields the shell with
  progress off. The books are not private; only progress and favourites are.

### What "cache present" means

There are **two** proofs, and either is enough:

- the password-wrapped envelope in `keyEnvelopes` (`hasProfileCache`), or
- the native biometric Vault, which stores the DEK itself and writes no envelope
  (`biometricVault.hasSavedValue`).

`offlineCacheState(hasEnvelope, vaultSaved)` is the whole rule. A "present"
cache is **not** "unlocked": a DEK must still enter memory before private rows
can be read, which is why `unlocked` is a separate input.

`hasSavedValue()` is a SharedPreferences `contains()`, so it stays true for a
value the Keystore can no longer decrypt. That is deliberate here: it is enough
to *offer* the unlock screen, and the failure is classified there.

### The unlock screen's exits

`OfflineUnlock` requires both callbacks, so a future call site cannot omit them:

| Control | Effect |
|---|---|
| Password form | `unlockProfileCache(profileId, password)` |
| Fingerprint (only when a saved value exists) | Vault unlock + `unlockProfileCacheWithKey` |
| **Change server address** | opens `ServerSetup` (stale `adb reverse` address is the common cause) |
| **Listen without progress** | `skippedUnlock = true`; the shell opens with `progressAvailable: false` |

Both exits stay enabled while a fingerprint prompt is open. A sensor that never
answers must not be able to hold the screen shut — the same mistake as the
disabled **Continue offline** button, in a different component.

The skip resets when the server becomes reachable or the profile changes — a
fresh session is a fresh chance to save progress, and a skip must never nag
mid-session.

### Progress that is not being saved

When the shell is offline, not unlocked, and holds books, one persistent line
says progress is not being saved. It is a line, not a prompt. `putPrivateValue`
already returns `false` without a key, so listening silently omits the write;
the shell is the only thing that admits it.

### A library that cannot be read

The replica read no longer swallows its failure. `useDeviceLibrary` records
`libraryReadError`, and the offline notice takes precedence over every other
explanation. **Try again** calls `probeServer()` *and* `device.refresh()`; the
old button only re-probed the server, so a broken read stayed broken.

### Offline with nothing downloaded

The shell renders with the Library tab as the only section. Discover, All books
and Favourites need the server or private data, so they are hidden rather than
shown dead. The header keeps Settings; the profile switcher is hidden because
the account list lives on the server. The shelf shows:

- **No books downloaded** (heading), one sentence of why,
- **Try again** (`probeServer()` + `device.refresh()`),
- **Change server address**.

A browser (no device library) keeps the old notice instead: "No books
downloaded" would be the wrong sentence where downloading is phone-only.

### Fingerprint lifecycle

`classifyBiometricFailure()` turns an error into one of:

| Failure | Cause | Response |
|---|---|---|
| `cancelled` | codes 5, 10, 13; "Use password" | silent — stay on the password form, never re-open the prompt |
| `lockout` | codes 7, 9 | say to wait; keep the saved key |
| `unavailable` | codes 1, 11, 12 (no sensor / none enrolled) | generic failure sentence; the hint covers the fix |
| `transient` | codes 2, 3, 8 | retry once |
| `key-invalid` | `VAULT_KEY_INVALID`, or the older "Biometric vault unavailable"/"Biometric check failed" | **clear** the saved value, explain once, fall back to password |
| `unknown` | anything else | fall back, clear nothing, retry once |

Only `key-invalid` clears. A value for another profile (`wrong-profile`) is
valid and is **not** cleared; the listener is told which account owns it.

The native plugin emits stable prefixes (`BIOMETRIC_CANCELLED`,
`BIOMETRIC_LOCKOUT`, `BIOMETRIC_UNAVAILABLE`, `BIOMETRIC_TRANSIENT`,
`VAULT_KEY_INVALID`, `VAULT_UNAVAILABLE`) while keeping the numeric code and
human message in the string, so an older client still classifies. The
`AccountGate` retry table previously inverted this (codes 1/2/5/8 retried),
which is why pressing "Use password" could re-open the prompt.

### Biometrics unavailable

Both surfaces explain instead of hiding the control:

- `DeviceUnlockSettings`: "Enrol a fingerprint in Android Settings to use device
  sign-in here."
- `AccountGate`: the same line when the selected account has a device credential
  but `available()` is false.

### Download recovery

The only remaining record of orphaned audio is the directory layout:
`books/<bookId>/<trackId>.<ext>`. Detection and adoption are separate:

| Step | Rule |
|---|---|
| Detect | list `books/`; keep numeric directory names; subtract replica ids → `unclaimed` |
| Adopt | `GET /api/audiobooks/:id` (server is the authority on what the files are) |
| Match | only `<trackId>.<ext>` where `trackId` is one of that book's real tracks |
| Record | `putReplicaBook` + `putDownloadedTrack` per matched file, `stat` for bytes |
| 404 | report missing; leave the folder **untouched** |
| Zero matches | report unmatched; leave the folder untouched |
| Server unreachable | report unreadable; leave everything untouched |

Never delete without a tap, and there is no delete in this build. Recovery is
idempotent: the same files adopted twice produce the same rows.

Detection is native-shell only and refreshed with the library. A listing failure
means "nothing found", never a visible error.

Offline, the shelf says the audio is on the phone and will be restored when the
server is reachable. Online, **Find them** runs the adoption and the shelf
refreshes.

## Non-goals

- No migration between the `http://localhost` and `https://localhost` origins.
  Recovery adopts **files**, not the old database, so old progress and
  favourites are not recovered.
- No storage-management screen; no automatic background repair.
- No changes to `androidScheme`, the mixed-content decision (ADR 014), or the
  server's library model.
- No tag writing (spec 13 stays deferred).

## Acceptance criteria

Each maps to a test in the client suite unless marked *device*.

Verified at `47b38df` + this change (2026-10-29): client `tsc -b` clean, 42 files /
521 tests passing, `check:copy` 441 strings / 0 errors, server suite 28 files /
507 passed (1 skipped), and a debug APK assembled (which compiles the Java
plugin changes). The device pass is the only open gate.

- [x] `waiting` is returned while the device library is reading. `offlineGate.test.ts`
- [x] A replica error yields `libraryReadFailed`, never "nothing downloaded". `offlineGate.test.ts`
- [x] Zero books never yields `unlock`. `offlineGate.test.ts`
- [x] `cache: "absent"` yields the shell with progress off. `offlineGate.test.ts`
- [x] `skippedUnlock` beats `unlock`. `offlineGate.test.ts`
- [x] Envelope-only, Vault-only, both and neither map to the right cache state. `privateCache.test.ts`
- [x] The unlock screen renders both exits and they call their handlers, including after a failed unlock. `OfflineUnlock.test.tsx`
- [x] Cancelling the prompt is silent and does not retry or clear. `AccountGate.test.tsx`, `AccountGate.biometric.test.tsx`, `biometricFailure.test.ts`
- [x] A transient prompt failure retries exactly once. `AccountGate.test.tsx`
- [x] An invalidated key is cleared; a wrong-profile value is not. `biometricFailure.test.ts` (classification) + `device` checklist for the real Keystore path
- [x] Continue offline is usable while a health check is in flight. `OfflineAndSetup.test.tsx`
- [x] The sensor-unavailable explanation appears in Settings and on sign-in. `DeviceUnlockSettings.test.tsx`, `AccountGate.biometric.test.tsx`
- [x] A two-track book is rebuilt from disk, unmatched files ignored, a 404 folder untouched, an unreachable server not mistaken for a deleted book, and a second run is idempotent. `recover.test.ts`
- [ ] *Device:* cold start offline with a working fingerprint reaches the shelf with progress.
- [ ] *Device:* "Listen without progress" plays, shows the persistent line, raises no error toast.
- [ ] *Device:* enrolling a new fingerprint invalidates the key; the app clears it and the password path still works.
- [ ] *Device:* offline with zero books enters the shell, reaches Settings, and changes the address.
- [ ] *Device:* orphaned folders from the interim origin are restored by **Find them**.

## Risks

| Risk | Mitigation |
|---|---|
| Shell code assumes a profile (progress, favourites) | `progressAvailable` gates private reads; `putPrivateValue` already no-ops without a key; the line says so |
| Hiding tabs breaks the navigation contract | Filter only when offline; `e2e/phone-layout` keeps one nav and asserts phone width |
| Recovery corrupts or duplicates rows | Ids make it idempotent; unmatched files ignored; nothing deleted |
| Java codes drift from the TS classifier | Message fallback retained; the numeric code stays in the message; device checklist covers cancel, invalidated key and wrong profile |
| Recovery is read as recovering *progress* | `LIMITATIONS.md` §1.4/§1.6 say plainly that files are recovered and old private rows are not |
