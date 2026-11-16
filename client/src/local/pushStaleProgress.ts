/**
 * Spec 44 — the reconnect push, client side.
 *
 * After a successful online refresh, push every cached progress row the
 * server is missing or has older values for. The decide function is the pure
 * `pushProgress.ts`; this module does the I/O.
 *
 * Failure keeps the cache (S5): a failed push is retried on the next good
 * refresh, and the cached row is never deleted here. Coalescing (S4) is the
 * caller's job — `useLibrary` rides `coalesceRefresh`, so a refresh storm
 * produces at most one push per book per cycle.
 */
import { request } from "../lib/request";
import { localDb, type LocalLibraryDatabase } from "./db";
import { readProgressMany } from "./privateCache";
import { decidePush } from "./pushProgress";
import { replicaBookKey } from "./replica";
import type { BookProgress } from "../types";

export interface PushBook {
  id: number;
  progress?: BookProgress | null;
}

export interface PushResult {
  /** Book ids whose cached position was pushed (insert order). */
  pushed: number[];
  /** Books inspected that needed no push. */
  skipped: number;
}

export async function pushStaleProgress(
  books: PushBook[],
  serverId: string,
  db: LocalLibraryDatabase = localDb,
): Promise<PushResult> {
  const cached = await readProgressMany(
    books.map(({ id }) => ({ bookId: id, serverId })),
    db,
  );
  const pushed: number[] = [];
  for (const book of books) {
    const decision = decidePush(cached.get(replicaBookKey(serverId, book.id)), book.progress ?? null);
    if (!decision.push) continue;
    try {
      await request(`/api/audiobooks/${book.id}/progress`, {
        method: "PUT",
        body: { position: decision.position, completed: decision.completed },
      });
      pushed.push(book.id);
    } catch {
      // Offline again, or the server refused: keep the cached row, the next
      // good refresh retries. Progress survives any number of failed pushes.
    }
  }
  return { pushed, skipped: books.length - pushed.length };
}
