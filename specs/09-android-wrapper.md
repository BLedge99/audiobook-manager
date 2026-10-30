# Spec 09 — Android Wrapper

> **Narrowed by `specs/26-android-app.md` and
> [`decisions/012`](../decisions/012-device-is-a-player-not-a-library-manager.md).**
> The "wrapper just points at the server URL" assumption below no longer holds:
> the app must work **without** the server, so it holds a local read replica and
> downloads audio to the device. Capacitor is now the chosen shell rather than a
> TWA-first default. Spec 26 is the authority; this file records the original
> intent and stays open only for the "installable APK on a household device"
> outcome it already shares.

## Purpose

Give the household a real "app" on Android: icon, splash, clean full-screen
experience, and a path to the Play Store later.

## Decision

Recommend **Capacitor** if we want native plugins (background audio resilience,
notifications, splash) and a single WebView codebase; **TWA via Bubblewrap** if
we just want the PWA wrapped with the Chrome engine (smaller, simpler pipeline).
Default: start with TWA; move to Capacitor if background audio proves weak.
Either way the React codebase is unchanged — the wrapper just points at the
server URL.

> Superseded: **Capacitor is now the default**, chosen because offline listening
> requires a foreground media service and a real filesystem. See ADR 012.

## Behaviour

- APK builds and installs on a household Android device.
- Points at the server on the LAN; shows a helpful error if the server is unreachable.
- No bundled server — the Pi/PC remains the source of truth.
- Deep links/back button behave sensibly.

## Acceptance criteria

- [ ] `npx cap add android` or Bubblewrap build produces an installable APK.
- [ ] App launches to the library, plays audio, resumes progress.
- [ ] Configuration for server URL documented; changeable without rebuilding the web app.
- [ ] README section: how to build/sign/install.

## Testing

- Manual device test matrix (one Android phone + one tablet) documented.

## Not in this spec

- Play Store publishing, iOS.
- **Offline listening, downloads and progress sync** — moved to
  `specs/26-android-app.md`.
