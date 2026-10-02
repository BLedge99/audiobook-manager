import path from "node:path";
import { realpathSync } from "node:fs";

/**
 * Resolve `filePath` to its real path and verify it lives inside `rootPath`.
 * Returns the resolved path, or null if it escapes the root.
 */
export function resolveInsideRoot(filePath: string, rootPath: string): string | null {
  try {
    const resolved = realpathSync(filePath);
    const resolvedRoot = realpathSync(rootPath);
    const relative = path.relative(resolvedRoot, resolved);
    if (relative === "" ) return resolved;
    if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
    return resolved;
  } catch {
    return null;
  }
}
