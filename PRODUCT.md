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
- Interface **voice is decided**: warm, plain and brief. See "Interface Voice"
  below, and `client/src/copy.ts` for the strings themselves.

## Interface Voice

**Decided 2026-10-20** (spec 15b feature 7). **Warm, plain and brief.**

- **Plain** means the listener never meets the filesystem. No paths, no
  formats, no "syncing" (product principle 1). "Folder", never "directory" or
  "library root". "Download", never "sync" or "fetch".
- **Warm** means the app is a friendly machine, not a corporate portal. The
  warmth is in the word choice, never a joke, and never at the cost of saying
  what happened. The capsule world is friendly; operator screens stay plain
  but not cold.
- **Brief** means the shortest wording that still carries meaning, consequence
  and recovery. Not "Invalid credentials" but "That password doesn't match.
  Try again." Not "Request failed (500)" but "Could not load the profiles
  (HTTP 500). Try again in a moment."

The rules the voice holds to:

- **Write for the listener.** The app has two audiences: the **listener**, who
  wants to find a book and press play, and the **operator**, who sets up the
  server and fixes metadata. They read different screens and need different
  words.
  **A heading, an explanation or a hint must say why the listener is there and
  what they can do, in their terms. It must not describe what the system is
  doing.**
  The failure mode is a heading like *"Home server library — select books to
  add to user library"*. It is a perfectly good comment to a developer and
  useless to a person: it names the system's structure, and the person already
  knows why they opened a screen called "All books". Said to the listener:
  **"Select books to add to your library."**
  So the copy table is split in two — `copy.ts` holds the listener-facing
  strings at the top level, and `copy.operator` holds the ones the person
  maintaining the server reads. Those may say "metadata" and "enrichment",
  because that is genuinely what those screens are about.
- One word per concept, everywhere. A saved title the person likes is a
  **favourite**, not a "like" or a "star". A catalogue suggestion is a
  **book**, not a "title" or an "item".
- **Status colour never travels alone** (`DESIGN.md`). Every status colour is
  paired with a written label.
- One ellipsis character: `…`, never three dots.
- No exclamation marks. A confirmation is a fact, not an event.
- Complete, translatable sentences. Numbers and variables are passed as
  values, not spliced into fragments, so a translator can reorder them.
- An error says what failed, why when that is known, and how to recover. A
  status code is never the whole message.

**Where the strings live:** [`client/src/copy.ts`](client/src/copy.ts), keyed
by surface, with a terminology glossary at the bottom. Every user-facing
string is there, including the ones the pure maths modules produce
(`lib/position.ts`, `lib/browse.ts`). Components hold no copy inline, so a
wording change is a one-line edit and the whole voice can be reviewed in one
sitting.

**How it is kept honest:** two layers, and neither changes a visible string.

- `client/src/copy.test.ts` fails the build if the listener tier contains the
  system's own vocabulary — "metadata", "enrichment", "taxonomy", "seeded",
  "cache", "home server" and the rest — or if an empty string, a `...` or an
  exclamation mark appears, if a shared phrase is written two different ways, or
  if a placeholder message is added without being named in `ICU_PENDING`.
- `scripts/check-copy.mjs` (the `ui-copy` skill's checker, vendored verbatim)
  reads the table against the `consumer-plain` profile, with `copy.operator`
  read as `professional-b2b`. `make check-copy` runs it, and it is part of
  `make test` and CI. The words this product bans live in
  `scripts/copy.config.json`; its `ignoreKeys` list is empty, and the rule is
  that the list may shrink but never grow.

The ban is on the **system's** words, not the **brand's**. "Shelf" is the
app's own metaphor — the visual world is a capsule vending machine, and a
vending machine has shelves — so a listener who sees one already knows what it
means. Only the machinery's vocabulary is out of bounds.

**And the listener never meets the operator's job.** No listener-facing string
names a folder, a scan or a review queue: those are things the person who runs
the server does, and naming them teaches the listener a job they do not have.

**The server does not write English.** API responses — errors and Discover's
success payload — return stable codes and values, and the client renders every
word. A message written on the server is a second catalogue, and no rule above
can reach it. (ADR 015; `Recommendation.reason` and `DiscoverResult.message`
use the same shape.)

**Translations are deferred, and labelled.** The messages that carry a number or
a name are template literals today, which is not a shape a translator can
reorder. They are named one by one in `copy.test.ts`'s `ICU_PENDING` list, which
is the migration checklist for ICU MessageFormat — not a promise that translation
is imminent.

## Brand Commitments

- The name is **Bookle**. It is confirmed and future work must not invent a
  different one.
- The visual world is **decided**: injection-moulded capsule vending, drawn by
  hand. Chosen by the user from five presented directions, then steered by them
  toward livelier and whackier, tilt and sketch character, minimal interiors and
  real transparency. Cute energy runs uniformly across every surface, operator
  screens included, by explicit decision. The system is recorded in
  [`DESIGN.md`](DESIGN.md) and the contract in
  [`specs/15-gui-redesign.md`](specs/15-gui-redesign.md).
- Interface **voice is decided** — see "Interface Voice" below.
- No logo exists. `client/public/favicon.svg` is now an authored capsule mark,
  and it matches the in-app mark drawn in `ui/primitives.tsx`.

### Shipped strings still to rename

These still say "Audiobook Manager" and are **placeholders**, not the brand.
This is a known divergence between this file and the repo docs, recorded here
deliberately rather than left to be discovered:

| Path | What to change |
|---|---|
| `client/index.html` | `<title>` and the Vite favicon link. **Favicon done** — now an authored capsule mark; `<title>` still says Audiobook Manager |
| `client/package.json` | `"name": "audiobook-client"` |
| `server/package.json` | `"name"`, and the broken `"scan"` script (LIMITATIONS 1.3) |
| `package.json` (root) | `"name"` |
| `README.md` | Title, one-liner, acknowledgements section |
| `PRD.md` | Title and "One-liner" |
| `AGENTS.md`, `roadmap.md`, `LIMITATIONS.md`, `specs/*`, `decisions/*` | Prose references; not user-facing, rename as prose edits. **roadmap.md and LIMITATIONS.md updated** for the spec 15 redesign |
| `Makefile`, `docker-compose.yml`, `Dockerfile.prod`, `.devcontainer/` | Service and container names; renaming changes host paths and volumes |

**The blocker, stated plainly:** `e2e/helpers.ts:42` matches the `<h1>` by exact
accessible name,

```ts
await expect(page.getByRole("heading", { name: "Audiobook Manager" })).toBeVisible();
```

so the visible wordmark cannot become Bookle without editing that line in the
same change. That line is the whole reason the wordmark still reads "Audiobook
Manager" in the redesigned app. It is a two-line change once the rename is
scheduled; it was left alone deliberately rather than silently made.

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

- Whether other households become real operators, and what that forces into
  first-run setup.
- The **rename itself** is still unscheduled, and it is the one outstanding piece
  of brand work. See the table above.
- Whether the Android app can reach a home server by LAN address at all. It
  currently cannot; see `LIMITATIONS.md` 1.6. This is now the single largest risk
  to the product's stated deployment.