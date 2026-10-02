# PRD — Audiobook Manager

## One-liner

A local-first, household audiobook server: it scans your library, enriches book
metadata, and delivers a polished Netflix-style browsing and playback experience
to desktop and Android clients over your home network.

## Who it serves

- **Primary users: family and household members.** Non-technical listeners who
  want to browse, play, and resume audiobooks without thinking about files,
  folders, oxygen of metadata, or apps "syncing".
- **Operator (initially you):** adds library folders, triggers scans, confirms
  metadata matches, manages profiles. Should not require developer skills for
  day-to-day use.
- **Host machine:** starts as a PC on the LAN, eventually a low-power
  Raspberry-Pi-class device.

## What the app does

1. Scan configured folders for audiobook files (MP3, M4B, FLAC, OGG, WAV, AAC).
2. Parse embedded tags, chapters, durations, and cover art (music-metadata + FFmpeg).
3. Group files into logical audiobooks (multi-file books, single M4Bs).
4. Enrich metadata via online sources (Open Library, Google Books) with a
   manual confirm step; user corrections win.
5. Present a Netflix-style library: grid, search, detail view.
6. Play audio with chapters, playback speed, sleep timer, and resume.
7. Per-user profiles with server-side listening progress and full history.
8. Progressive Web App on Android (installable); native-ish wrapper later.
9. Optional AI features via LM Studio (matching, summaries) that never gate
   core functionality.

## Goals

- A household member can scan, browse, play, and resume across devices with no
  understanding of the underlying files.
- Playback experience is excellent on mobile browsers on the LAN.
- The system is safe to run permanently in the home: guarded filesystem access,
  no media mutation by default, survives reboots.

## In scope

- Library scanning, metadata extraction, cover art, online enrichment
- Per-user profiles and server-side progress/history
- Full playback UX (chapters, speed, sleep timer)
- PWA Android support and a later WebView wrapper
- Optional LM Studio AI features behind an adapter
- Full test suite: unit (backend + frontend), integration, Playwright E2E,
  and a dedicated security test project

## Out of scope (for now)

- Remote/internet access (aspirational; local network only — see
  `decisions/006-remote-access.md`)
- Transcoding, M4B merging, metadata embedding into files (future stretch,
  manual-only)
- Social features, sharing outside the household, ratings from strangers
- Multi-server sync, cloud backup
- Native iOS app, third-party stores requirement

## Success criteria

- All roadmap features reach their finish lines in `roadmap.md`.
- Playwright E2E suite passes against the docker-compose stack.
- Security suite (path traversal, bad input, range abuse) passes.
- A non-technical family member can use the app end-to-end unassisted.
