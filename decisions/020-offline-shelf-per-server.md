# ADR 020 — The offline library is a set of per-server shelves, shown as a union

## Status

Accepted (2026-10-30). Supersedes the implicit single-server assumption carried by
[`specs/29-offline-resilience.md`](../specs/29-offline-resilience.md)
("Download recovery", decision table) and the "device holds a replica" framing of
[ADR 012](012-device-is-a-player-not-a-library-manager.md) with respect to
*which server* the replica belongs to.

## Context

Spec 29 made the offline branch work, but the replica it writes into was keyed by
bare book id and carried no server provenance. Recovery adopts against the
**connected** server, and the offline shelf is rendered from whatever rows the
device holds.

The household hit the consequence directly (2026-10-30): three books downloaded
from the local server, then the app pointed at the production deploy; production
never saw those book ids, so "Find them" could not confirm them and reported
*"Nothing could be restored"* — while the audio was still on the phone, playable,
and simply owned by a server the app was no longer talking to.

## Decision

**The device's downloaded library is a set of per-server shelves. The
listener-facing offline shelf is the union of those shelves.**

Concretely:

1. Every downloaded or adopted book row records the **source server** it belongs
   to, and is keyed locally as `<serverId>#<bookId>`.
2. The offline shelf lists downloaded books across all of the device's shelves
   (the union), each playable offline through the local file path — which was
   already the case and is unchanged.
3. Online browsing continues to read the connected server's catalogue; downloaded
   markers and the offline shelf are device-side and multi-server.

Rejected alternatives:

| Alternative | Why rejected |
|---|---|
| **Single global shelf keyed by bare book id** (status quo before this ADR) | Two servers can both have a book id 5 that means something different; a single key silently merges or overwrites across servers. |
| **One Dexie table per server** | More tables to manage, no real win; the composite key expresses the same boundary with one table. |
| **Always clear the local library when the server address changes** | Was not what caused the loss (rows were simply not multi-server), and clearing would throw away good offline state. |
| **Adopt foreign audio without any server confirmation** | Violates spec 29's "never claims something it cannot prove". Provenance tagging is what makes cross-server adoption coherent, not bypassing confirmation. |

## Consequences

- The listener can download from server A, then server B, and both remain in the
  offline library, playable offline, regardless of the address the app is pointed
  at.
- Adoption ("Find them") still runs against the connected server; a 404 there
  means the *connected* server lacks the book, not that the device never had it.
- The Dexie replica schema moves to version 4 (composite key). As the schema
  comment already blessed: replica rows are disposable — a book can always be
  re-downloaded — so the upgrade path is a discard-and-redownload rather than a
  data migration.

## Related

- [`specs/30-offline-library-per-server.md`](../specs/30-offline-library-per-server.md)
- [`specs/29-offline-resilience.md`](../specs/29-offline-resilience.md)
- [`decisions/012-device-is-a-player-not-a-library-manager.md`](012-device-is-a-player-not-a-library-manager.md)
- [`decisions/018-offline-cache-is-provable-two-ways.md`](018-offline-cache-is-provable-two-ways.md)
