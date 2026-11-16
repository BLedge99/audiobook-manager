# Spec 44 — Offline→online progress sync

> **Status: implemented 2026-11-16; ships with the v0.2.0 release (spec 43).**
> Part of the production-readiness plan (spec 43, phase 1.3). The README
> promises "progress syncs after you reconnect" — as of this change it does:
> on every successful online refresh the client pushes cached rows the server
> is missing or older than (spec-44 S1), and `cacheLibraryPrivateState` no
> longer deletes cached progress it cannot supersede (S3). 14 new unit tests;
> both suites green.

## Purpose

When a listener plays an offline-downloaded book with no server reachable —
the Android app, or a browser on a network with no route home — the server
write in `saveProgress` fails and only the encrypted private cache holds the
position. On reconnect **nothing pushes that position back**, and the next
successful online refresh runs `cacheLibraryPrivateState`, which overwrites the
cached row with the server's older position — or deletes the row outright when
the server payload carries no progress. The listener's offline progress is
silently dropped. For a feature whose entire point is "pick up where you left
off, even switching devices", that is a trust-destroying defect.

This spec defines the fix: a **one-directional push** of cached progress to the
server on reconnect, decided by `lastPlayed` ordering, with no new UI. A full
bidirectional, per-field-merge sync engine is explicitly out of scope (spec 43,
Appendix A option B) — this is the smallest behaviour that honours the README.

## Behaviour contract

### Definitions

- `cached` — the entry under `cacheProgress`'s key, i.e.
  `replicaBookKey(serverId, bookId)`, carrying `{ position, completed,
  lastPlayed }`.
- `server` — the book's `progress` as delivered by `GET /api/audiobooks`
  (or the per-profile shelf payload) on the next online refresh.
- **Newer** — compare `lastPlayed` (ISO 8601, server-parseable). If `cached`'s
  `lastPlayed` is strictly later than `server`'s (or `server` has none),
  `cached` is newer. **Ties and unparseable values: the server wins.** Client
  clocks are never trusted over the server's record; when in doubt, nothing is
  pushed and nothing is lost (see rule S3).

### Rules

- **S1 (push on reconnect).** After any successful online library/progress
  refresh, for each book where `cached` is newer than `server`, issue
  `PUT /api/audiobooks/:id/progress` with the cached `position`, `completed`
  and `lastPlayed`. Note there is **no server-side monotonic rule today** —
  spec 26 specced one (forward applies, backwards-clamped, `allowRewind`) but
  it never landed, so the client comparison in this spec is the only guard
  against a stale push.
- **S2 (server wins, cache follows).** If `server` is newer, the cache is
  updated from the server payload exactly as today — the offline shelf shows
  the server's truth on the next read.
- **S3 (cache is never silently dropped for a missing server value).**
  `cacheLibraryPrivateState` must **not** delete a cached progress row merely
  because the server payload lacks progress. A cached row is only superseded or
  deleted when the server's `lastPlayed` is strictly newer (comparison as
  above; ties keep the cache). An offline-listened book with no server row
  survives refresh.
- **S4 (one push per reconnect, coalesced).** The push rides the same
  `coalesceRefresh` machinery the library uses; a refresh storm produces at
  most one push per book per cycle. No new timers.
- **S5 (failure keeps the cache).** If the push itself fails (server down
  again), the cached row is kept untouched and the next successful refresh
  retries. Progress must survive arbitrarily many failed pushes.
- **S6 (empty server history, non-empty cache, previously-unplayed book).**
  Push happens; the server gains a fresh row with the cached values. No
  special case beyond S1.

### Non-goals

- No conflict UI, no merge, no per-field granularity.
- No server-side monotonic/clamping rule: spec 26 specced one and it never
  landed. This spec does not implement it — a clamp would break ordinary
  backward seeks, and the client-side comparison (S1) already prevents the
  reconnect flow from rewinding the server.
- No new network round-trips beyond the single `PUT` per stale book.
- No change to favourites/wishlist/membership sync (out of scope; Appendix A
  option B covers those one day).

## Files

- `client/src/local/pushProgress.ts` (new) — the pure decide function
  (`decidePush`) and the server-supersede predicate (`serverStrictlyNewer`);
  unit-tested in isolation.
- `client/src/local/pushStaleProgress.ts` (new) — the I/O: reads the cache,
  PUTs the stale rows, keeps failures silent. Locked cache = no push, no
  loss (password sign-in remembers the key via `useAccountGate`).
- `client/src/local/privateCache.ts` — `cacheLibraryPrivateState` implements
  S3 (conditional supersede instead of unconditional delete).
- `client/src/useLibrary.ts` — after a successful online refresh, calls the
  push for the merged library (S1/S4); failure leaves the cache (S5).
- `client/src/components/ChapterPlayer.tsx` — unchanged.
- Tests: `client/src/local/pushProgress.test.ts` (decision matrix + S3 cache
  rules), `client/src/useLibrary.test.tsx` (reconnect flow via stubbed
  fetch), Playwright or documented manual pass on the Android shell.

## Acceptance criteria

1. Offline listen at 41:22 → connectivity restored → next refresh issues the
   `PUT`, and `GET /api/audiobooks` then reports `position = 41:22`.
2. Server has 55:00 (listened on another device), cache has 41:22 → after
   refresh, cache reads 55:00 and the server is unchanged.
3. Server has no progress for the book, cache has 41:22 → after refresh the
   server reports 41:22 and the cached row is not deleted.
4. `lastPlayed` ties → no push; server values win; cache updated.
5. Unparseable cached `lastPlayed` → no push; logged; nothing deleted.
6. Push fails (server 500/unreachable) → cache unchanged; next good refresh
   retries the push; no rows lost after any number of failures.
7. A stale cache never reaches the server: the S1 comparison refuses the
   push. (The server is last-writer-wins — the monotonic rule specced in
   spec 26 never landed. A concurrent online listen mid-push is accepted as
   last-writer-wins, as it has always been; full mitigation is spec 43
   Appendix A option B.)
8. `cacheLibraryPrivateState` unit tests cover: server missing + newer cache
   (kept), newer server (superseded), tie (kept).
9. Client suite green; `make test` green; no API response-shape change; no
   new dependency.

## Test notes

The S1/S2 decision matrix is 3×3-ish and pure — exhaustive unit coverage is
cheap and expected. The reconnect orchestration in `useLibrary.ts` is tested
against mocked `fetch` (the existing `lib/request.ts` test seam); the
IndexedDB private cache uses the existing `fake-indexeddb` rig from
`privateCache.test.ts`. Clock skew is exercised by stamping cached rows with
future/past `lastPlayed` values; none of the tests use wall-clock sleeps.

## GDPR

No new personal-data category. Progress rows already exist; this spec moves
where a write can originate, not what is stored. `docs/roa.md` Activity 4
(listening progress) wording gains one clause: "positions may be written by
the client on reconnect, subject to the server's monotonic rule". Retention is
unchanged (erasure still removes everything, spec 43 Phase 5).
