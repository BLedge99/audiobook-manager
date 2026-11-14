/*
 * Gallery integrity check: every image the gallery references must exist.
 *
 * Why this exists: docs/design-lab/ is built by checkouts from variant
 * branches, and branch switches happily delete files that were only ever
 * staged, never committed. The gallery was left referencing screens that no
 * longer existed. This is cheap insurance: parse both views, assert the
 * files, fail loudly.
 *
 * Usage: node scripts/design-lab-check.js
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join("docs", "design-lab");
const FILES = ["gallery.md", "gallery.html"];
const IMG = /(?:src="|\]\()((?:gen-0|gen-1)[^ )"]+\.(?:png|jpe?g|webp|webm|mp4))"?/g;

let missing = 0;
for (const file of FILES) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) {
    console.error(`MISSING VIEW: ${full}`);
    missing += 1;
    continue;
  }
  const text = fs.readFileSync(full, "utf8");
  for (const match of text.matchAll(IMG)) {
    const target = path.join(ROOT, match[1]);
    if (!fs.existsSync(target)) {
      console.error(`${file}: references missing ${match[1]}`);
      missing += 1;
    }
  }
}
if (missing) {
  console.error(`\nGallery integrity FAILED: ${missing} missing asset(s).`);
  process.exitCode = 1;
} else {
  console.log("Gallery integrity OK — all referenced assets exist.");
}
