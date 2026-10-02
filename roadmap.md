# Roadmap

Ordered. Each item has a finish line — that's the definition of done. Each item
has a matching spec in `specs/`.

| # | Feature | Finish line |
|---|---------|-------------|
| 01 | Scanner consolidation | One canonical scanner module; duplicate `services/scanner.ts` removed; tests green |
| 02 | Test infrastructure | `npm test` runs backend + frontend unit suites; `npx playwright test` runs E2E headless via docker compose |
| 03 | Per-user profiles & household auth | Multiple named profiles; each has isolated progress/history; single shared household password gates the app |
| 04 | Server-side progress & full listening history | Position, completed, sessions, speed, timestamps persist per profile per book and survive device switches |
| 05 | Playback experience core | Resume, speed control, sleep timer, chapter seek all work in desktop and mobile browsers |
| 06 | Chapter support | M4B chapters and multi-file track lists render and seek correctly; chapter editing possible later |
| 07 | Metadata enrichment | Every book can be matched to Open Library/Google Books, confirmed or corrected manually, covers/descriptions filled |
| 08 | PWA packaging | App installable on Android home screen, offline shell, lock-screen/background playback behaves |
| 09 | Android wrapper | Capacitor or TWA wrapper builds an installable APK pointing at the server |
| 10 | LAN deployment | Server runs on home hardware (PC → Pi), reachable from all LAN devices, survives reboot, documented setup |
| 11 | Security hardening & testing | Filesystem access confined to library roots; security test suite (traversal, bad input, range abuse) in CI-style run |
| 12 | AI features (LM Studio, optional) | At least one guarded AI feature ships (metadata matching assistant or description summaries); app fully works with it off |
| 13 | Media tools (stretch) | Manual, explicit metadata/cover embedding into files with confirmation; no silent writes |

## Notes

- Items 01–06 form the playable, syncable core.
- Items 07–09 complete the household product.
- Items 10–11 make it trustworthy to leave running.
- Items 12–13 are enhancements; do not start until 01–05 are solid.
- Remote/internet access is intentionally absent; see `decisions/006-remote-access.md`.
