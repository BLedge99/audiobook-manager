#!/usr/bin/env node
/**
 * Spec 45, phase 10 — every eslint suppression must carry `-- reason:`.
 *
 * react-hooks suppressions are legitimate here (mount-once wiring, refs read
 * at call time), but the 2026-11-17 re-audit found the repo had drifted into
 * the habit of bare suppressions whose "reason" lived in a comment nobody
 * was required to notice. This check closes that: a suppression is
 * non-conforming unless the same line carries `-- reason:` with something
 * after it.
 *
 * A suppression conforms iff: `eslint-disable(-next-line|-line)?\s+… --\s*reason:` on one line.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.argv[2] ?? "src";

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "admin-dist") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx)$/.test(full)) yield full;
  }
}

const DIRECTIVE = /eslint-disable(-next-line|-line)?\s+\S.*--\s*reason:\s*\S/;
const ANY_DIRECTIVE = /eslint-disable(-next-line|-line)?\s+\S/;

const offenders = [];
for (const file of walk(ROOT)) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!ANY_DIRECTIVE.test(line)) return;
    if (!DIRECTIVE.test(line)) offenders.push(`${path.relative(process.cwd(), file)}:${index + 1}`);
  });
}

if (offenders.length > 0) {
  console.error("eslint suppressions without `-- reason:` on the same line:");
  for (const site of offenders) console.error(`  ${site}`);
  process.exit(1);
}
