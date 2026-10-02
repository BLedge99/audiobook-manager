# Spec 08 — PWA Packaging

## Purpose

Make the web app installable on Android home screens with an app-like shell and
decent media behaviour, so "the app" exists without a Play Store build.

## Behaviour

- `vite-plugin-pwa` (Workbox) registers a service worker: offline app shell,
  cached static assets, runtime passthrough for `/api/*` (no caching of streams).
- `manifest.webmanifest`: name, icons (192/512), theme colour,
  `display: standalone`.
- Media Session API continues to drive Android lock-screen controls (spec 05).
- Install prompt handled gracefully; iOS/desktop get "install" affordances where supported.
- Background audio: acceptable on Android Chrome when playing via the HTML5
  audio element; document limitations.

## Acceptance criteria

- [ ] Lighthouse PWA audit passes installability checks.
- [ ] "Add to Home Screen" on Android yields a standalone app.
- [ ] Offline: shell loads with cached UI; API errors show a clean banner.
- [ ] Streams are never served from the service worker cache.
- [ ] Playwright PWA checks (manifest presence, SW registration) where feasible.

## Testing

- Lighthouse CI or manual audit documented; Playwright checks manifest/SW.

## Not in this spec

- Play Store APK (spec 09), iOS app.
