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

**One addition the implementation needed:** `Profile.followsServerLibrary`.
"Migrated to contain every book" says what is true at the moment of the
migration; it does not say what happens to a book scanned *next month*. The
flag says that, and it is what makes a fresh install behave like a migrated
one: the profiles that existed when the feature shipped (and the six default
seeded profiles) follow the server library and keep receiving new books, while
a profile created afterwards starts empty and does not. Removing a book does
**not** clear the flag — "not that one" is not "not any new ones".

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

### The "All books" tab

A **separate tab**, not a mode of the Library tab. The reason is that the two
answer different questions: *what do I have?* and *what else is on the server?*
Collapsing them into one screen with a toggle makes the common case (my shelf)
harder to read to make the rare case (the full server) possible.

- It lists every book the server has, **including** books the profile already
  has, each marked.
- It is where the "add to your library" action lives.
- It is **not** where listening happens. Adding a book to a profile does not
  start a download, and downloading is a separate, explicit action.
- The tab is called **"All books"** and its heading is **"Select books to add
  to your library"** — not "Server library". The listener is not looking for a
  server; they are looking for more books to add. That is the copy rule from
  `PRODUCT.md`, applied to the one surface this spec adds.

- **Offline, the tab falls back to the books on this device.** The shelf
  belongs to the server, so offline there is genuinely nothing to add — and
  the tab says so rather than pretending otherwise. But the tab is not dead:
  while the server cannot be reached, the app's library *is* the books on this
  device (that is what the Library tab is showing, and what the offline banner
  says), and taking one of those away is a local operation that needs no
  server. So the tab lists them with a **Remove** that deletes the download,
  and offers no Add button.

  The boundary, stated plainly: **membership lives on the server**, so a
  removal that only changes a profile's library cannot happen offline. What
  happens offline is the removal the app can actually carry out. Making an
  offline removal reach the server later is a change queue, and it would need
  its own spec.

### Removing a book

Removing a book from a profile offers to **delete its download too**, and the
offer is a real question with two answers, not a checkbox:

- The download is on the *device*; the membership is on the *server*. Removing
  from the profile does not have to free the space, and not freeing it is the
  safe default when the question is not asked.
- If the download is deleted, the file is gone from the device and the book's
  metadata leaves the local store with it. The server copy is untouched — the
  book is still on the server and can be added back.

**The question is only asked when there is a download to ask about.** Leaving
the library is recoverable — the book stays on the server and the "All books"
tab can add it back — so it does not need a confirmation. Deleting the
*download* is not recoverable, so that is the one worth a question.

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

- [x] A new profile's library is empty; the server library is not.
- [x] An existing profile, migrated, still sees every book it saw before.
- [x] `GET /api/audiobooks` returns only the caller's membership.
- [x] Adding a book twice is idempotent.
- [x] The "All books" tab lists every book on the server and marks the ones
      the profile already has.
- [x] Adding a book from the "All books" tab makes it appear in the Library
      tab without a manual refresh of the server.
- [x] Removing a book offers to delete the download, and answering "no" leaves
      the file on the device.
- [x] Answering "yes" frees the space and the book leaves the device's
      library, but remains on the server and can be added back.
- [x] The cover cache still evicts at 512 MB, and membership changes never
      move that number.
- [x] Progress for a removed-then-restored book is intact for that profile.
- [x] Server-side: no path from the client is ever resolved outside a
      configured library root.
- [x] Offline, the "All books" tab still lists the books on the device and can
      remove one; it offers no Add button, and it does not claim the household
      has no audiobooks.
- [x] A removal that cannot reach the server leaves the book in the library,
      says the server could not be reached, and does not leave the shelf
      claiming the book has gone.

**Verified on the live stack** (2026-10-21): an existing profile sees 12
books, a brand-new profile sees 0, adding one makes it 1, removing it makes it
0 again, and the server still has 12 throughout.

**Verified on the device** (2026-10-21, Motorola Defy, Android 11): with the
app believing the server was unreachable, the "All books" tab showed
"Books on this device", the intro ("You're offline, so there's nothing new to
add. You can still remove the ones you've downloaded."), the three books on the
phone, and a Remove on each — with no Add button and no empty-shelf message.

## What the implementation settled that the spec left open

The three open questions above, answered:

1. **Does a profile that is not a member of a book still see it in search
   results?** No. The library listing is scoped to the membership, so search
   over it cannot surface a book the profile has not added. The "All books" tab
   is the separate place to look at everything, and it has its own list rather
   than a search over the library.

2. **What happens to a book that is removed from *every* profile?** It stays on
   the server. The server library is a property of the filesystem, and a book
   removed from every profile simply appears in nobody's shelf. Confirmed on the
   live stack.

3. **Does the migration run for the default seeded profiles?** Yes, and the
   six default profiles are treated as *following* the server library, so a
   fresh install behaves exactly like a migrated one — a book scanned tomorrow
   reaches them without anyone touching anything. A profile created *in the
   app* is different: it starts empty and does not follow, which is the spec's
   decision.

   That distinction needed one new field, `Profile.followsServerLibrary`. It is
   the spec's existing-vs-new rule made explicit, and it is what makes
   "a book scanned tomorrow" behave the same way for a household that has
   been using the app for years and for one that installed it this morning.

## One thing the implementation found that the spec did not ask about

**The removal is a server call, and the app has to say so when it cannot be
made.** The household took books out of their library on a phone that had lost
the server, and the books stayed -- over and over, with refresh doing nothing.

Three things were wrong, and none of them was the membership feature:

1. The app learned the server was unreachable only from a **probe**, which
   ran at startup and when the window regained focus. A phone that lost the
   server in between went on showing the shelf it had loaded, with buttons
   that looked alive and silently did nothing. Now **every failed request
   re-probes**, and the probe decides: a single blip does not take the app
   offline, and a server that is really gone puts the app into the offline
   state it should have been in.
2. The failure was reported in the browser's language -- `Failed to fetch` --
   which names neither cause and no fix. It is now one sentence with a next
   step, used by every failed request.
3. The optimistic flag was not rolled back, so the shelf said "removed" while
   the library said "still here". **The shelf and the library are one fact
   seen twice**, and a failed removal now puts the flag back.

**The membership model itself was correct throughout**: the server's log shows
no `DELETE` to the membership endpoint ever arriving, and the profile still
held every book. The feature did exactly what it was asked to do; the request
never left the phone.

**The migration files and `schema.prisma` had drifted, and `prisma db push` in
dev had hidden it for the life of the project.** The schema says `ON DELETE
CASCADE` on `Track`, `ListeningHistory` and `MetadataCandidate`; the migrations
say `RESTRICT`, because the original migrations omitted `onDelete` and SQLite
applies RESTRICT to a relation with none. The schema even carries a note
saying the original migration omitted it; the migration was never corrected to
match, so the fix only ever reached development databases.

In production — which uses `prisma migrate deploy` — **deleting a book failed
with a foreign-key error**, and so did removing a library folder, because
deleting the root cascades to its books and their tracks pointed at them.

Spec 27 needed a *data* migration, and `db push` cannot run one, so the dev
stack had to move to `migrate deploy` — which exposed the drift. A corrective
migration rebuilds the three tables, and dev now runs the same command
production does, so the two cannot disagree silently again.

## Not in this spec

- Per-profile privacy (PIN, biometrics) — user-testing finding 2, needs its own
  ADR.
- The downloaded-books list and "Remove from device" — spec 26's unmet
  criterion, recorded in `LIMITATIONS.md` §3.
- The lock-screen latency fix — user-testing finding 6, needs measuring first.
