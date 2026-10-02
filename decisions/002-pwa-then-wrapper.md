# ADR 002 — PWA first, wrapper over native rewrite

## Status
Accepted

## Context
Android clients are needed. A native rewrite would duplicate the React app.

## Decision
Build the React app as a proper PWA (installable, app-like). Later wrap it with
TWA (default) or Capacitor for a Play-Store-style APK, without touching the web
codebase.

## Alternatives considered
- **React Native / Expo rewrite** — full UI duplication, losing Tailwind web work.
- **Capacitor immediately** — extra build pipeline before PWA basics are done.

## Consequences
- Some PWA background-audio limitations on Android; Capacitor is the escape hatch.
- One codebase to maintain.
