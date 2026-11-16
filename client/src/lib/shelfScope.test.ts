/**
 * Spec 42, phase 7 — one shelf scope, one answer.
 *
 * A shelf-scoped thing with no recorded origin belongs to the connected
 * server; before this phase that was spelled `serverId ?? getServerUrl()` at
 * the functional read sites and `serverId ?? ""` at the JSX-key sites — two
 * answers, drifting by construction (React keys and cache keys disagreed for
 * the same book).
 *
 * `shelfScopeOf` is the single answer, and this sweep keeps the two
 * spellings from creeping back in. (`sourceServer ?? ""` in download.ts and
 * recover.ts stays: there the absence of a server identity is deliberate —
 * the unscoped offline shelf — and is not the connected-server default.)
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** `shelfScopeOf` itself, and its home. */
const ALLOWED = new Set([path.resolve(__dirname, "api.ts")]);

const SPELLINGS = [/serverId \?\? getServerUrl\(\)/, /serverId \?\? ""/];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "admin-dist") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx)$/.test(full)) yield full;
  }
}

describe("the shelf scope default (spec 42, phase 7)", () => {
  it("is spelled nowhere outside shelfScopeOf", () => {
    const offenders: string[] = [];
    for (const file of walk(path.resolve(__dirname, ".."))) {
      if (ALLOWED.has(file)) continue;
      if (/\.test\.(ts|tsx)$/.test(file)) continue; // fixtures may spell the default
      const source = readFileSync(file, "utf8");
      if (SPELLINGS.some((re) => re.test(source))) offenders.push(path.relative(process.cwd(), file));
    }
    expect(offenders).toEqual([]);
  });
});
