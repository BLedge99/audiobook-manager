import path from "node:path";
import { realpathSync } from "node:fs";

/**
 * Root realpaths are resolution of configuration, not of user input: the same
 * library root is resolved on every stream/cover request. Cached for a short
 * window (30 s) — the file-side realpath still runs per request, so a root
 * re-pointed at a different tree can at worst be honoured for half a minute,
 * and a root whose target dies surfaces on the next miss.
 */
const ROOT_TTL_MS = 30_000;
const rootCache = new Map<string, { value: string; expiresAt: number }>();

function rootRealpath(rootPath: string): string {
  const hit = rootCache.get(rootPath);
  const now = Date.now();
  if (hit && hit.expiresAt > now) return hit.value;
  const value = realpathSync(rootPath);
  rootCache.set(rootPath, { value, expiresAt: now + ROOT_TTL_MS });
  // Housekeeping: never let the map grow unbounded across root churn.
  if (rootCache.size > 100) {
    for (const [key, entry] of rootCache) {
      if (entry.expiresAt <= now) rootCache.delete(key);
    }
  }
  return value;
}

/**
 * Resolve `filePath` to its real path and verify it lives inside `rootPath`.
 * Returns the resolved path, or null if it escapes the root.
 */
export function resolveInsideRoot(filePath: string, rootPath: string): string | null {
  try {
    const resolved = realpathSync(filePath);
    const resolvedRoot = rootRealpath(rootPath);
    const relative = path.relative(resolvedRoot, resolved);
    if (relative === "") return resolved;
    if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
    return resolved;
  } catch {
    return null;
  }
}
