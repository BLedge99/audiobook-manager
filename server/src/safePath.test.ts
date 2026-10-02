import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveInsideRoot } from "./safePath";

const dir = mkdtempSync(path.join(tmpdir(), "safepath-"));
const libRoot = path.join(dir, "lib");
const outside = path.join(dir, "outside");

beforeAll(() => {
  mkdirSync(libRoot, { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(path.join(libRoot, "book.mp3"), "audio");
  writeFileSync(path.join(outside, "secret.txt"), "secret");
  symlinkSync(path.join(outside, "secret.txt"), path.join(libRoot, "escape.mp3"));
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("resolveInsideRoot", () => {
  it("accepts files inside the root", () => {
    expect(resolveInsideRoot(path.join(libRoot, "book.mp3"), libRoot)).not.toBeNull();
  });

  it("rejects files outside the root", () => {
    expect(resolveInsideRoot(path.join(outside, "secret.txt"), libRoot)).toBeNull();
  });

  it("rejects symlinks that escape the root", () => {
    expect(resolveInsideRoot(path.join(libRoot, "escape.mp3"), libRoot)).toBeNull();
  });

  it("rejects nonexistent paths", () => {
    expect(resolveInsideRoot(path.join(libRoot, "missing.mp3"), libRoot)).toBeNull();
  });
});
