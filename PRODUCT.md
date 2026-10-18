# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

The React client is the product surface. It ships three ways from one codebase:
a desktop browser, an installable PWA on Android, and a Capacitor/WebView APK
(ADR 002, ADR 012). The APK is a shell around the web app, not a native design
language, so it does not make the platform `android`.

## Name

**Bookle**

- Tagline: your audiobook library, at home.
- One line: a local-first audiobook server that scans your own files, enriches
  the metadata, and serves a Netflix-style browse and playback experience to
  the household over the home network.

## What It Is

Bookle scans configured folders for audiobook files (MP3, M4B, FLAC, OGG, WAV,
AAC), parses embedded tags, chapters, durations and cover art, groups files
into logical books, and enriches metadata from online providers (Open Library,
Google Books, Audnexus, LibriVox) behind a manual confirm step. It then serves
browse, search, detail and playback surfaces with per-profile progress and
history.

It is self-hosted. There is no cloud account, no subscription, and no remote
access to the home server (ADR 006). Listening away from home works by
downloading a book to the device, not by reaching the server over the internet
(ADR 012).

## Who It Serves

- **Listeners (primary):** family and household members. They browse, play and
  resume, and must never have to think about files, folders, missing metadata,
  or apps "syncing". They are not technical and do not install anything but the
  app.
- **Operator (initially one person):** adds library folders, triggers scans,
  confirms metadata matches, manages profiles and tags. Day-to-day operation
  must not require developer skills.
- **Audience boundary:** built for one household now; other households are a
  later possibility. Onboarding and self-service setup must not create rework,
  but setup friction is tolerable while that is true.

## Positioning

A neighbouring product could copy "streaming UI". It cannot truthfully copy
this: Bookle's library is the household's own storage, it never writes to media
files, it works with all AI features switched off, and the device is a
synchronised player holding a read replica rather than a second library
manager that can diverge from the server.

## Operating Context

- Host runs on a LAN PC today, targeted at a Raspberry-Pi-class device later;
  it must survive reboots and run unattended.
- Docker Compose plus a Makefile is the operational surface: `make start`,
  `make scan`, `make restart`, `make logs`.
- Metadata coverage is uneven in practice. `LIMITATIONS.md` is the authority on
  what does not work and why; read it before estimating anything touching
  enrichment, narrators, covers or search.
- One shared household password gates the app; named profiles sit behind it
  with isolated progress and history (ADR 003, roadmap item 03).
- The Android app is sideloaded, so updates are manual.

## Capabilities and Constraints

- Never auto-write tags or metadata into user media files. Enrichment lives in
  the database. Embedding into files is a separate, explicit, user-confirmed
  feature (spec 13, currently out of scope).
- AI via LM Studio is optional and offline; it augments and never gates core
  behaviour.
- Filesystem access is confined to configured library roots; clients send IDs,
  never paths.
- The database is authoritative. Progress, scan state and history sync across
  devices.
- Accessibility bar: **WCAG 2.2 AA**. This includes surviving Android WebView
  font boosting (the incident documented in `client/src/index.css`) without
  blocking pinch-zoom, and not regressing it for any reason.
- Undecided: voice and tone of interface copy. Copy exists in the app but has
  not been confirmed as a commitment.

## Brand Commitments

- The name is **Bookle**. It is confirmed and future work must not invent a
  different one.
- No logo, icon set or wordmark exists. `client/public/` holds only
  `placeholder-cover.svg`, and `client/index.html` still links `/vite.svg` as
  its favicon.
- No voice, personality or visual direction has been confirmed. Visual world is
  deliberately unset here.

### Shipped strings still to rename

These still say "Audiobook Manager" and are **placeholders**, not the brand.
This is a known divergence between this file and the repo docs, recorded here
deliberately rather than left to be discovered:

| Path | What to change |
|---|---|
| `client/index.html` | `<title>` and the Vite favicon link |
| `client/package.json` | `"name": "audiobook-client"` |
| `server/package.json` | `"name"`, and the broken `"scan"` script (LIMITATIONS 1.3) |
| `package.json` (root) | `"name"` |
| `README.md` | Title, one-liner, acknowledgements section |
| `PRD.md` | Title and "One-liner" |
| `AGENTS.md`, `roadmap.md`, `LIMITATIONS.md`, `specs/*`, `decisions/*` | Prose references; not user-facing, rename as prose edits |
| `Makefile`, `docker-compose.yml`, `Dockerfile.prod`, `.devcontainer/` | Service and container names; renaming changes host paths and volumes |

The rename is **not yet scheduled.** Per `AGENTS.md`, it needs a roadmap entry
and a matching `specs/NN-*.md` file first; doing it as a bare sweep would
violate the source-of-truth order.

## Evidence on Hand

- Real LibriVox MP3 sample libraries in `test/` for scanner fixtures.
- Live provider APIs (Audnexus, LibriVox, Open Library, Google Books), with
  verified gaps recorded in `LIMITATIONS.md`. Google Books is non-functional
  without an API key.
- Playwright E2E suite with a dedicated security project.
- A working PWA and a sideloaded Capacitor APK, verified on a Pixel 4a.

No testimonials, customer names, benchmarks, usage analytics, press, or pricing
exist. This is a single-household tool. Future work must not fabricate any of
these.

## Product Principles

1. **The listener never meets the filesystem.** No paths, no formats, no
   "syncing" in the interface.
2. **The media files are read-only.** Everything Bookle learns lives in the
   database; the household's originals are never touched without an explicit,
   confirmed action.
3. **Everything works with AI off.** Optional intelligence augments a product
   that is already complete.
4. **The device is a player, not a second library manager.** One authority
   (the server), a read replica and a progress store on the phone.
5. **Safe to leave running.** It lives on a home network unattended, so
   filesystem access stays guarded and the standard is WCAG 2.2 AA.

## Open Decisions

- Interface voice and tone.
- Visual world and design system. Unset by design; not part of this file.
- Whether other households become real operators, and what that forces into
  first-run setup.