#!/usr/bin/env node
/**
 * Bundle budget. Run after `npm run build` in client/.
 *
 * The split that matters is not the total (that only grows) — it is that the
 * *app* chunk does not creep and the vendor chunks stay cacheable. Budgets
 * carry ~10 % headroom over the 2026-11 split; raise them deliberately, in
 * the same change as whatever legitimately grew the bundle.
 *
 *   node scripts/check-bundle-size.mjs   # from client/, or pass the dist dir
 */
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const distDir = process.argv[2] ?? path.join(process.cwd(), 'dist', 'assets');

const budgets = [
  { pattern: /^index-.*\.js$/, label: 'app chunk (index)', maxBytes: 320 * 1024 },
  { pattern: /^react-.*\.js$/, label: 'react vendor', maxBytes: 240 * 1024 },
  { pattern: /^dexie-.*\.js$/, label: 'dexie vendor', maxBytes: 110 * 1024 },
  { pattern: /^icons-.*\.js$/, label: 'icons vendor', maxBytes: 30 * 1024 },
  { pattern: /^index-.*\.css$/, label: 'app CSS', maxBytes: 64 * 1024 },
];

let failures = 0;
const files = readdirSync(distDir);
for (const { pattern, label, maxBytes } of budgets) {
  // There are two index-*.js files: the app chunk and the lazy @simplewebauthn
  // chunk. The budget is about the app chunk, so take the largest match.
  const matches = files.filter((name) => pattern.test(name));
  const match = matches.sort((a, b) => statSync(path.join(distDir, b)).size - statSync(path.join(distDir, a)).size)[0];
  if (!match) {
    console.error(`MISSING  ${label}: no file matching ${pattern} in ${distDir}`);
    failures += 1;
    continue;
  }
  const size = statSync(path.join(distDir, match)).size;
  const ok = size <= maxBytes;
  console.log(`${ok ? 'ok     ' : 'OVER    '} ${label.padEnd(22)} ${(size / 1024).toFixed(1)} KB (budget ${(maxBytes / 1024).toFixed(0)} KB)`);
  if (!ok) failures += 1;
}
if (failures > 0) {
  console.error(`\n${failures} bundle budget(s) exceeded in ${distDir}.`);
  process.exit(1);
}
console.log('\nAll bundle budgets met.');
