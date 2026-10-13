# ADR 012 — The device is a synchronised player, not a second library manager

## Status
Accepted (supersedes the "wrapper just points at the server URL" assumption in spec 09)

Implemented by [`specs/26-android-app.md`](../specs/26-android-app.md), which
also narrows `specs/09-android-wrapper.md`.

## Context
The product targets **commercial audiobooks**, and the household needs to listen
while away from home. The existing stack cannot do that at all:

- The PWA sets `runtimeCaching: /api/ → NetworkOnly`, so **nothing works
  offline** — that was deliberate, not an oversight.
- `capacitor.config.ts` hardcodes `server.url`, so the current wrapper is a thin
  view of the server and is **completely non-functional without it**.
- Prisma cannot run in a WebView (no Node, own query-engine binary), so
  "run the whole backend on the phone" is not a configuration choice.

The naive reading — "port the server to the device" — implies a second copy of
the scanner, `safePath`, enrichment, taxonomy, tags, contributors and chapters:
~22 tables and two implementations of the entire domain, forever.

But asking what the device actually needs to do **without the server** gives a
much smaller list:

1. Play audio — needs the **files** locally
2. Show the library — needs **metadata** locally
3. Resume — needs **progress** locally

Not required offline: scanning, enrichment, tagging, taxonomy, contributor
management, Discover. The user confirmed this directly: tags and enrichments
need to be *readable* offline once downloaded, but never *written* offline.

## Decision

**The server remains the only library manager. The device holds a read replica
of metadata and a writable progress store, and is a player.**

- **Metadata on device is a read-only replica.** It is refreshed from the server
  when a book is downloaded. No offline edits, ever.
- **Audio lives on the device filesystem**, one book at a time.
- **Progress is the only device-side write.**
- **No remote access to the server is required.** Books are downloaded over the
  LAN and progress syncs on return home, which preserves ADR 006.

### Storage split

| Concern | Choice | Why |
|---|---|---|
| Shell | **Capacitor**, sideloaded APK | Not for native feel. For a **foreground media service** (Android 13+ kills background PWA audio) and a **real filesystem** (Cache Storage is evictable; app-private storage is not) |
| Metadata | **Dexie / IndexedDB** | The read surface is tiny (book, tracks, progress). No SQL needed for a read replica. Works identically in the PWA and the WebView, so one code path, and it stays testable in the existing jsdom suite |
| Audio | **Capacitor Filesystem** | `<audio>` cannot stream or seek a blob in IndexedDB; gigabytes in IDB is memory-hostile |

**Trigger to revisit native SQLite** (`@capacitor-community/sqlite`): if offline
*editing* is ever required, or if the query surface outgrows key-value access.

## Alternatives considered

- **Full server stack on the device** — rejected. Prisma cannot run in a
  WebView, so it needs a native SQLite plugin or WASM SQLite *and* a rewrite of
  every persistence module. This is the only option that duplicates the whole
  domain model, and it makes the phone a library manager nobody asked it to be.
- **VPN / tunnel to the home server** — rejected, and the user's instinct was
  right. It needs setup on both the home server and the phone, breaks under
  CGNAT without a managed tunnel, exposes a home network publicly, and depends
  on home power and broadband. Worst of all, streaming a 30-hour audiobook
  over a home uplink while commuting is a bad experience.
- **Improve the PWA only (download + IndexedDB + service worker)** — rejected as
  the *primary* experience. Background audio with the screen off is unreliable
  in a PWA on Android, and browser-managed storage can be evicted. Retained as a
  fallback: the Dexie layer and the read-replica design work in either shell.
- **Streaming proxy with device-side cache** — rejected. Same wide-area
  bandwidth problem as tunnelling, plus a cache that is still evictable.

## Consequences

- The device store is a **replica**, so it can go stale. Bounded: a book is
  refreshed whenever it is (re)downloaded, and the UI must show what is local.
- **Offline tags/genres/series come free** with the replica, which is exactly
  what was asked for.
- No offline *editing*, so a conflict on metadata edits cannot arise. Only
  progress can conflict — see spec 26.
- Sideloading means **manual updates**. Acceptable for a household; self-hosted
  APK auto-update is available if it becomes a chore.
- App-private files are **invisible to the user's Files app**, so "why is my
  phone full?" becomes a support question. MediaStore would fix it at real
  complexity cost.
- Phase 0 (a `LibraryStore` read-model seam on the server) is pure de-risking
  with no user-visible payoff of its own, and is reviewed separately.