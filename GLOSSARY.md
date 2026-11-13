# GLOSSARY

The domain vocabulary of audiobook-manager, one line per term. Terms are
drawn from `PRD.md`, `DESIGN.md`, the specs and `decisions/`; where an ADR is
the authority, it is cited. Architecture vocabulary (module, interface, depth,
seam, leverage, locality) lives in the improve-codebase-architecture and
codebase-design skills — this file names the *domain*, not the code.

## The product in one line

- **audiobook** — a logical book: one title and one set of metadata, possibly
  spanning many audio files (multi-part MP3s) or a single M4B/FLAC. Grouped by
  the scanner; never the same thing as a file.
- **track** — one file that belongs to an audiobook, ordered by `trackNumber`.
- **chapter** — a named segment within an audiobook (embedded chapters of an
  M4B, or derived). Chapter 1 is where playback starts; progress is measured
  against tracks and segments.

## Storage and scanning

- **library root** — a configured folder the operator added for scanning. All
  filesystem access is confined to library roots (see `specs/11`).
- **scanner** — the batch process that walks library roots, parses tags with
  FFmpeg/music-metadata, groups files into audiobooks and upserts them.
  Consolidated in ADR 005; never writes into media files.
- **embedded metadata** — tags read from the file itself: title, author,
  narrator, cover. Highest-trust automatic source; loses to user overrides.
- **derived** — values inferred from filename/folder structure when nothing
  else is present. The weakest source in the precedence chain.
- **field override / user override** — a field a human set by hand (title,
  narrator…). Enrichment and the scanner must not overwrite it (ADR 009,
  enforced per field; see ADR 028).
- **enrichment** — the online metadata pass: providers are queried, candidates
  scored, and confident matches applied automatically or queued for review.
- **provider** — an external metadata source behind the `MetadataProvider`
  interface: Open Library, Google Books (title-driven), LibriVox, Audnexus
  (ASIN-keyed chapter lookup only, ADR 030). Configured, not hard-coded.
- **review queue** — enrichment candidates below the auto-apply confidence
  threshold, waiting for a human to accept or reject them.
- **narrator** — the voice actor credited on the book; a first-class
  contributor recorded independently of author.

## People, sessions and access

- **household** — the family the server is for. The `household` password
  gates account creation and sign-in; it is not a per-person credential.
- **profile vs account** — a **profile** is a listener's identity inside the
  household (name, colour, progress, shelf). An **account** (spec 32, ADR 016)
  is the sign-in wrapper around a profile in production/demo mode. Every
  profile is an account; "profile" is the household term, "account" the
  production term.
- **session** — a signed-in state backed by a row in `sessions`; only its
  token hash is stored. Validated per request (`validate()`), renewed on a
  sliding window, capped at 90 days absolute.
- **device credential** — a long-lived, device-bound secret (Android) used to
  re-establish a session without a password. Rotating, single per device,
  hash-stored, revocable (spec 36).
- **demo mode** — the production demo experience: no household password;
  OAuth/email sign-in, per-account shelves, age-gated kids' accounts, no
  admin routes. A different product surface with the same player.
- **admin listener** — the second Fastify app on port 3100: the operator
  panel (scan trigger, DB browser, age ratings). A separate **door**, not a
  separate implementation (ADR 022); the family listener never serves it.
- **family listener** — the main server on port 3000 that households use.

## The experience

- **shelf** — the grid of audiobooks shown in the library tab, per profile.
  The personal **profile shelf** is what a listener curated; the **server
  shelf** ("server library") is everything the operator made available, most
  of it not yet on the personal shelf. Shopping from the server shelf adds
  books to the personal shelf.
- **favourites** — the household-wide per-profile heart/like list; independent
  of shelf membership.
- **progress** — a profile's resume position in a book: position in seconds,
  completed flag, derived chapter/segment. Server-authoritative, synced to
  devices.
- **listening history** — the append-only log of play sessions; drives
  "recently played" and stats. Separately erasable (GDPR).
- **offline replica / replica shelf** — the on-device copy of the library and
  of a profile's private state (progress, favourites), keyed per server and
  per book as `<serverId>#<bookId>`. The union of server shelf and device
  shelf is what the offline UI renders (ADR 020).
- **offline mode** — the explicit, user-chosen state where the app stops
  probing the server and renders from the replica only. Never dead-ends:
  every screen leaves a way out; `offlineMode` is one value in one home
  (`lib/offlineMode.ts`).
- **DEK / key envelope / Vault** — the data-encryption key behind the
  profile's private rows. Stored (a) password-wrapped in an envelope in
  IndexedDB, or (b) on the device Keystore (Android Vault). The listener
  proves the profile with the household password or a fingerprint to unlock
  it; "Open your downloads" is that moment.
- **genre / tag taxonomy** — the two-level curated genre tree plus free-form
  per-book tags. A **catch-all** genre bucket exists on purpose (unmapped
  provider genres land there; it is not deletable).
- **age band / kids' accounts** — household accounts for children with an
  age ladder (ADR 033); content outside the band is invisible and unplayable.

## Process words this repo uses exactly

- **spec** — one file per roadmap feature in `specs/`: behaviour, acceptance
  criteria and checks. The definition of done lives there.
- **roadmap** — the ordered list of specs in `roadmap.md`; number is the
  build order.
- **ADR** — a decision in `decisions/`, numbered sequentially at merge time.
- **LIMITATIONS** — known gaps and why they exist; read before estimating
  anything (`LIMITATIONS.md`). A known gap is documented, never silently
  worked around.
