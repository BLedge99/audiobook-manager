import type { BookProgress } from "../types";

/**
 * Spec 44 / 43 phase 1.3 — the reconnect push.
 *
 * The decide function is pure so the whole policy is unit-tested without a
 * network, an IndexedDB or a server. Rules:
 *
 * - cached newer than server  → push (server lastPlayed missing also counts as
 *   "server has no position", so a book first listened to offline gets one)
 * - otherwise                  → no push (ties and unparseable values: the
 *   server wins; client clocks never beat the server's record)
 * - `completed: true` on the cache is pushed like any other position
 */

export type PushDecision =
  | { push: true; position: number; completed: boolean }
  | { push: false };

function parseLastPlayed(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function decidePush(
  cached: BookProgress | undefined,
  server: BookProgress | null | undefined,
): PushDecision {
  if (!cached) return { push: false };
  const cachedAt = parseLastPlayed(cached.lastPlayed);
  if (cachedAt === null) return { push: false }; // garbage cached row: keep, never push
  const serverAt = parseLastPlayed(server?.lastPlayed);
  if (serverAt === null || cachedAt > serverAt) {
    return { push: true, position: cached.position, completed: cached.completed };
  }
  return { push: false };
}

/** True when the server payload may supersede the cached row. Server strictly newer. */
export function serverStrictlyNewer(
  server: BookProgress,
  cached: BookProgress | undefined,
): boolean {
  if (!cached) return true;
  const serverAt = parseLastPlayed(server.lastPlayed);
  const cachedAt = parseLastPlayed(cached.lastPlayed);
  if (serverAt === null) return false; // server value untrustworthy: keep the cache
  if (cachedAt === null) return true; // cached garbage: server wins
  return serverAt > cachedAt;
}
