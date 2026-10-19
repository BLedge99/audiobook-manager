# Spec 27 — Per-profile library membership

## Purpose

The library on the server is the household's. The **library a profile sees** is
its own: a curated shelf of books that profile cares about.

Today every profile sees every book, because the library *is* the server's
library. That is wrong for a household where adults and children share one
server, and it is what makes the "server library" idea necessary: the server
holds everything that was ever scanned; each profile holds the subset it wants.

This spec is **planned, not started**. It is written before the code, per
`AGENTS.md`.

## The decision

**New profiles start empty. Existing profiles are migrated to contain every
book.**

The asymmetry is deliberate and reversible, and it is one line to flip:

- A **new** profile is a fresh start. It contains nothing until someone adds
  something. This is the whole point of the feature: a child's profile should
  not inherit the parent's library.
- An **existing** profile is migrated to contain every book, so that shipping
  this feature **changes nothing for anyone who already has the app**. No
  household's existing library silently empties on upgrade.

The migration is therefore the *only* place where "all books" is correct, and it
is a one-time data migration, not a default. If the household later decides new
profiles should start with the full library, that is one line in the profile
creation path — and it is why the rule lives in code rather than in a migration
script.

**Not a per-profile copy of the files.** Membership is a *row*, not a file. The
audio file stays exactly where it is, in the library root, and two profiles can
membership of the same book. Only the *download to device* is per device, and
that is already the case.

## Behaviour

### The shelf

- `GET /api/audiobooks` returns **the caller's membership**, not the whole
  server library. Every existing client call site — the grid, the dock, the
  shelves, search, the detail dialog, the player — inherits this without
  change, because they all read that one endpoint.
- Membership is keyed `(profileId, mediaItemId)`, unique. Adding a book twice is
  idempotent, not an error. The same shape as the existing `Favourite` model,
  which is already per-profile and idempotent.
- `POST`/`DELETE` on the membership. The client sends **IDs, never paths**, and
  the server resolves the book from the database — the security rules in
  `specs/11-security-hardening.md` are unchanged by this feature.

### The "Server library" tab

A **separate tab**, not a mode of the Library tab. The reason is that the two
answer different questions: *what do I have?* and *what else is on the server?*
Collapsing them into one screen with a toggle makes the common case (my shelf)
harder to read to make the rare case (the full server) possible.

- It lists every book the server has, **including** books the profile already
  has, each marked.
- It is where the "add to my library" action lives.
- It is **not** where listening happens. Adding a book to a profile does not
  start a download, and downloading is a separate, explicit action.

### Removing a book

Removing a book from a profile offers to **delete its download too**, and the
offer is a real question with two answers, not a checkbox:

- The download is on the *device*; the membership is on the *server*. Removing
  from the profile does not have to free the space, and not freeing it is the
  safe default when the question is not asked.
- If the download is deleted, the file is gone from the device and the book's
  cover and metadata leave the local store with it. The server copy is
  untouched — the book is still on the server and can be added back.

This is **not** the storage-management UI. That is the visible "downloaded
books" list with "Remove from device" from spec 26, which the household removed
from the polish pass on 2026-10-19 and which is recorded as an unmet criterion
in `LIMITATIONS.md` §3. This spec only asks the question in the one place where
removal happens.

### What this does *not* touch

- **The cover cache.** It is a device cache of bytes, capped at 512 MB and
  evicted least-recently-used. Membership does not change the cap, does not
  evict, and does not get a per-profile quota. The cache is about *bytes on
  this phone*; membership is about *which books this person is browsing*. Two
  different questions, and coupling them would mean a cache that shrinks when
  a book leaves a profile and grows when it comes back.
- **Progress.** Progress is already per `(profile, book)`. A book that leaves a
  profile and comes back keeps its position for that profile, because the
  progress row was never deleted.
- **Enrichment, tags, favourites, wishlist.** All unchanged.

## Schema

One new table, additive, SQLite-compatible and PostgreSQL-compatible:

```
model ProfileLibraryEntry {
  id         Int      @id @default(autoincrement())
  profileId  Int
  mediaItemId Int
  createdAt  DateTime @default(now())

  profile   Profile  @relation(...)
  mediaItem MediaItem @relation(...)

  @@unique([profileId, mediaItemId])
  @@index([mediaItemId])
}
```

Migrations stay additive. No column is removed or repurposed.

## Acceptance criteria

- [ ] A new profile's library is empty; the server library is not.
- [ ] An existing profile, migrated, still sees every book it saw before.
- [ ] `GET /api/audiobooks` returns only the caller's membership.
- [ ] Adding a book twice is idempotent.
- [ ] The "Server library" tab lists every book on the server and marks the
      ones the profile already has.
- [ ] Adding a book from the Server library makes it appear in the Library tab
      without a manual refresh of the server.
- [ ] Removing a book offers to delete the download, and answering "no" leaves
      the file on the device.
- [ ] Answering "yes" frees the space and the book leaves the device's
      library, but remains on the server and can be added back.
- [ ] The cover cache still evicts at 512 MB, and membership changes never
      move that number.
- [ ] Progress for a removed-then-restored book is intact for that profile.
- [ ] Server-side: no path from the client is ever resolved outside a
      configured library root.

## Open questions to settle before coding

1. **Does a profile that is not a member of a book still see it in search
   results?** The default in this spec is no — the endpoint returns membership
   only, so search cannot surface a book the profile has not added. But a
   "search the server" affordance inside the Server library tab may want the
   opposite. Decide before the endpoint is written, because it changes the
   query, not the UI.
2. **What happens to a book that is removed from *every* profile?** It stays on
   the server (the server library is a property of the filesystem), and it
   simply appears in nobody's shelf. No deletion. Confirm this is wanted.
3. **Does the migration run for the default seeded profiles?** The six default
   profiles (Dad, Mum, Archie, Ben, Playwright, Testing) are seeded on first
   boot. They should be migrated like any other profile, so the app looks
   unchanged on a fresh install too.

## Not in this spec

- Per-profile privacy (PIN, biometrics) — user-testing finding 2, needs its own
  ADR.
- The downloaded-books list and "Remove from device" — spec 26's unmet
  criterion, recorded in `LIMITATIONS.md` §3.
- The lock-screen latency fix — user-testing finding 6, needs measuring first.
