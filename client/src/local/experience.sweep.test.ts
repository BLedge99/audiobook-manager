/**
 * Spec 42, phase 10 — the demo-vs-household comparison has one home.
 *
 * The kids sweep pins the child comparison to `local/kids.ts`; this sweep
 * does the same for the demo literal, which had sixteen hand-rolled copies
 * across eight files when the audit counted.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** The predicates that own the literal. */
const ALLOWED = new Set([path.resolve(__dirname, "experience.ts")]);

const INLINE = /(===|!==)\s*["']demo["']/;

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "admin-dist") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx)$/.test(full)) yield full;
  }
}

describe("the demo literal has one home (spec 42 phase 10)", () => {
  it("no source file compares against the demo literal inline outside experience.ts", () => {
    const offenders: string[] = [];
    for (const file of walk(path.resolve(__dirname, ".."))) {
      if (ALLOWED.has(file)) continue;
      if (/\.test\.(ts|tsx)$/.test(file)) continue; // tests may pin the literal
      if (INLINE.test(readFileSync(file, "utf8"))) offenders.push(path.relative(process.cwd(), file));
    }
    expect(offenders).toEqual([]);
  });
});
