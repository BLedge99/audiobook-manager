/**
 * The spec-41 phase-4 sweep: the kids buy-surface predicate has exactly one
 * home. The leaf surfaces (ExternalBooks, GetThisBookSheet, Discover,
 * AccountMenu, App) render-covered for the child role; this suite stops the
 * comparisons from creeping back in inline anywhere else.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Files allowed to compare the role literal: the predicates that own it. */
const ALLOWED = new Set([
  path.resolve(__dirname, "kids.ts"),
  path.resolve(__dirname, "ageFilter.ts"),
]);

const inlineCompare = /role\s*(===|!==)\s*["']child["']/;

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "admin-dist") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx)$/.test(full)) yield full;
  }
}

describe("the child role literal has one home (spec 41 phase 4)", () => {
  it("no source file compares the role inline outside the owning modules", () => {
    const offenders: string[] = [];
    for (const file of walk(path.resolve(__dirname, "../.."))) {
      if (ALLOWED.has(file)) continue;
      if (/\.test\.(ts|tsx)$/.test(file)) continue; // tests assert the predicate/props, not the policy
      if (inlineCompare.test(readFileSync(file, "utf8"))) offenders.push(path.relative(process.cwd(), file));
    }
    expect(offenders).toEqual([]);
  });
});
