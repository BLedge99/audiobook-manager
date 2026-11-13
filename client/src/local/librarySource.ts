/**
 * The library source seam.
 *
 * The listener's shelf is **one concept** with two implementations: the
 * books the server holds, and the books this device holds. They were merged
 * by hand in `App.tsx`, with the key format written out inline in both
 * places, so a change to the format would silently produce duplicate shelf
 * entries -- or, worse, make one server's book disappear behind another's.
 *
 * Two adapters justify the seam: the server shelf and the device shelf. The
 * merge lives here, with the key format it uses, so there is one place that
 * knows how a shelf is keyed.
 */
import type { Audiobook } from "../types";
import { replicaBookKey } from "./replica";
import { filterBooksForKids } from "./ageFilter";

/**
 * One shelf of books.
 *
 * A source that names its server holds **one** server's catalogue. A source
 * that does not holds a **union** of shelves -- the device shelf is a set of
 * per-server shelves (spec 30) -- and its books carry their own `serverId`.
 */
export interface LibrarySource {
  /** The books this source holds. */
  books: Audiobook[];
  /**
   * The server whose catalogue these books came from.
   *
   * `undefined` means each book carries its own `serverId`.
   */
  serverId?: string;
}

/**
 * Merge the server's shelf and the device's into one list.
 *
 * The rules, in one place:
 *
 *  - the **server shelf is dropped** when the server could not be reached:
 *    its last successful list is stale, and showing it beside the device's
 *    books would show the listener a shelf that is no longer true. Pass
 *    `null` for it.
 *  - where both shelves hold the same book, the **server's copy wins**: it is
 *    the one the server has just confirmed.
 *  - a device book from **another server** is kept: it is a different book
 *    that also belongs on the shelf.
 *
 * The key is `<serverId>#<bookId>`, the same one the replica rows use.
 */
export function mergeShelves(
  serverShelf: LibrarySource | null,
  deviceShelf: LibrarySource,
  currentServerId: string,
  childFilter?: { role?: string | null; ageBand?: string | null },
): Audiobook[] {
  const merged = new Map<string, Audiobook>();

  const add = (source: LibrarySource) => {
    for (const book of source.books) {
      const serverId = source.serverId ?? book.serverId ?? currentServerId;
      const key = replicaBookKey(serverId, book.id);
      // The server matters as much as the id to every consumer downstream of
      // this list (covers, favourites, progress): unstamped books would look
      // like this server's books. Same book from two shelves keeps the first
      // (server) copy; a foreign book carries its own server.
      if (!merged.has(key)) merged.set(key, { ...book, serverId });
    }
  };

  if (serverShelf) add(serverShelf);
  add(deviceShelf);

  const books = [...merged.values()];
  // Spec 38: the offline device shelf is filtered with the same ladder. The
  // server shelf is already filtered server-side; this is a no-op for it.
  return childFilter ? filterBooksForKids(books, childFilter.role, childFilter.ageBand) : books;
}
