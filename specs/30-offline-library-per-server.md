# Spec 30 — Offline library is per server, and holds what the device downloaded

## Purpose

The offline library has to survive the household's real deployment pattern:
**one phone, several audiobook servers** (the local dev stack on the home PC and
the production deploy at `audiobook-manager.onrender.com`, and any future
secondaries). A book downloaded from one server must not become invisible,
unplayable or unrestorable just because the listener later pointed the app at a
different server.

The failure this spec fixes (observed 2026-10-30, see
`LIMITATIONS.md` §1.4):

- Audio was downloaded from the local server; the device held it under
  `books/<bookId>/<trackId>.<ext>`.
- The listener switched the app's server address to the production deploy.
- The production database never saw those books, so the local book ids were
  unknown there.
- **Find them** (spec 29 recovery) asked the *connected* server, got a 404, and
  reported *"Nothing could be restored. The audio is still on the phone."* — even
  though the audio was sitting there the whole time.

## Context

- Spec 29 made the server the **authority** for adoption: an orphaned folder is
  adopted only when `GET /api/audiobooks/:id` confirms it, and a 404 is reported
  as a missing book, leaving the folder untouched. That is correct behaviour for
  a server that genuinely lost a book; it is wrong for a device that downloaded
  from a *different* server than the one it is currently pointed at.
- The replica was implicitly **single-server**: rows were keyed by bare book id
  and carried no record of which server they came from. Adoption wrote rows
  against the connected server, so an adopted book's provenance was the connected
  server — and a listener who switched servers in between lost the ability to
  reconcile the two.
- Audio itself was already server-independent once a row existed: adopted tracks
  play from a `content://` file URL (`Filesystem.getUri` → `convertFileSrc`).
  The server was only ever needed for metadata.

## Behaviour

### Shelves

The device library is a **set of per-server shelves**, plus the union the listener
actually hears from.

- A **shelf** is one server (by normalised origin) and the downloaded/adopted books
  belonging to it. Rows live in the device replica keyed by
  `<serverId>#<bookId>`.
- The **offline shelf** the listener browses is the **union** of every shelf the
  device holds downloaded audio for — across servers. This is what makes the
  "download from A, then from B, both should be here" promise true: the local
  library is a property of the device, not of whichever server answered last.
- An online browse still reads the *connected* server's catalogue for what is
  in that profile's library; downloaded markers and the offline shelf use the
  device union.

### Provenance

- Every downloaded book row is tagged with the **source server** it was
  downloaded from.
- Every adopted book row is tagged with the server that **confirmed** it.
- Two shelves may legitimately hold books with the same numeric id (two different
  libraries); the composite local key keeps them apart.

### Recovery

- Detection (`Find them`) compares orphan folders against **every shelf the
  device holds rows for** — the union of the device's per-server shelves — so an
  adopted book from another server is not re-flagged as orphan after the
  listener switches to that server. Adoption still runs against the *connected*
  server, which remains the authority it can confirm through.
- Adopted rows are tagged with the connected server, so the audio now belongs to
  a shelf the device can name.
- A 404 on the connected server remains "this server does not have it" (missing);
  with per-server shelves the listener can therefore move from server A (adopt)
  to server B (download) and both keep showing up.

## Decisions

| # | Question | Decision |
|---|---|---|
| 1 | How is the offline library structured? | A set of per-server shelves; the listener-facing offline shelf is the union of downloaded rows. |
| 2 | How are shelves keyed? | Composite local key `<serverId>#<bookId>` (Dexie schema v4; replica rows are disposable, so the destructive upgrade path already blessed in the schema comment stands). |
| 3 | Who is the authority on adoption? | Still the connected server, per spec 29. Provenance tagging is what lets the union hold audio from more than one server. |
| 4 | Is playback server-anchored? | No. Adopted/downloaded tracks play from local files; unchanged. |

## Acceptance criteria

- [ ] A book downloaded from server A appears in the device's offline library
      while the app is pointed at server B, and plays offline.
- [ ] A book downloaded from server B, after adopting one from server A, is
      downloadable and adoptable independently.
- [ ] Adoption of an orphaned folder still requires server confirmation (spec 29
      behaviour preserved) and tags the adopted row with the confirming server.
- [ ] Existing single-server flows are unchanged (regression suite green).

## Non-goals

- No server-side storage of offline state (ADR 012 keeps the device authoritative).
- No cross-server *streaming* of audio that was never downloaded to the device.
- No migration of progress/favourites across servers (private rows stay per
  profile; audio and shared metadata are what move).

## Related

- [`specs/29-offline-resilience.md`](29-offline-resilience.md) (recovery contract),
  [`decisions/012-device-is-a-player-not-a-library-manager.md`](../decisions/012-device-is-a-player-not-a-library-manager.md),
  [`decisions/018-offline-cache-is-provable-two-ways.md`](../decisions/018-offline-cache-is-provable-two-ways.md).
