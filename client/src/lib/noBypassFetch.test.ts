/**
 * Spec 42, phase 3 — the bypass class stays closed.
 *
 * Every personal-data or live-session route must carry the request guarantee:
 * bounded, authenticated, profile-scoped (x-profile-id) when the household
 * deployment needs one. The GDPR self-service surface shipped dead in the
 * household deployment because ~31 call sites used raw boundedFetch instead of
 * the request interface — the class this sweep pins shut.
 *
 * `boundedFetch` remains legal exactly where the bottom layer enforces it:
 * its own definition, the one request interface above it, and the reachability
 * probe, which is deliberately exempt (it answers "is the server listening",
 * not "what is my data", and is documented as such).
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Files allowed to name boundedFetch directly. */
const ALLOWED = new Set([
  path.resolve(__dirname, "api.ts"), // defines it
  path.resolve(__dirname, "request.ts"), // the one path above it
  path.resolve(__dirname, "reachability.ts"), // the documented bare probe
]);

const CALL = /\bboundedFetch\s*\(/;

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "admin-dist") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx)$/.test(full)) yield full;
  }
}

describe("the request boundary (spec 42, phase 3)", () => {
  it("only the bottom-layer modules call boundedFetch directly", () => {
    const offenders: string[] = [];
    for (const file of walk(path.resolve(__dirname, ".."))) {
      if (ALLOWED.has(file)) continue;
      if (/\.test\.(ts|tsx)$/.test(file)) continue; // tests stub the layer, they don't bypass it
      if (CALL.test(readFileSync(file, "utf8"))) offenders.push(path.relative(process.cwd(), file));
    }
    expect(offenders).toEqual([]);
  });
});
