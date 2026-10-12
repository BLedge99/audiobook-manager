import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveInsideRoot } from "./safePath";

const dir = mkdtempSync(path.join(tmpdir(), "safepath-"));
const libRoot = path.join(dir, "lib");
const outside = path.join(dir, "outside");

// Creating a symlink on Windows needs Developer Mode or an elevated shell.
// Without it the whole suite fails in beforeAll, so probe for the capability
// and skip the one symlink-specific case rather than losing the other three.
//
// The probe runs at module scope, not in beforeAll: `it.skipIf(...)` is
// evaluated while the suite is being *collected*, which happens before any
// beforeAll hook runs.
mkdirSync(libRoot, { recursive: true });
mkdirSync(outside, { recursive: true });
writeFileSync(path.join(libRoot, "book.mp3"), "audio");
writeFileSync(path.join(outside, "secret.txt"), "secret");

let symlinksAvailable = true;
try {
  symlinkSync(path.join(outside, "secret.txt"), path.join(libRoot, "escape.mp3"));
} catch {
  symlinksAvailable = false;
}

afterAll(() => {
  // Windows may hold a transient handle; cleanup is best effort.
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

describe("resolveInsideRoot", () => {
  it("accepts files inside the root", () => {
    expect(resolveInsideRoot(path.join(libRoot, "book.mp3"), libRoot)).not.toBeNull();
  });

  it("rejects files outside the root", () => {
    expect(resolveInsideRoot(path.join(outside, "secret.txt"), libRoot)).toBeNull();
  });

  it.skipIf(!symlinksAvailable)("rejects symlinks that escape the root", () => {
    expect(resolveInsideRoot(path.join(libRoot, "escape.mp3"), libRoot)).toBeNull();
  });

  it("rejects nonexistent paths", () => {
    expect(resolveInsideRoot(path.join(libRoot, "missing.mp3"), libRoot)).toBeNull();
  });
});
