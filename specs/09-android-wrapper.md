# Spec 09 — Android Wrapper

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
