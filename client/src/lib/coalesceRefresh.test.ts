import { describe, expect, it, vi } from "vitest";
import { coalesceRefresh } from "./coalesceRefresh";

describe("coalesceRefresh (spec 41 phase 6)", () => {
  it("concurrent callers share the in-flight run instead of duplicating it", async () => {
    let started = 0;
    let releaseFirst: (() => void) | null = null;
    const fn = vi.fn(async () => {
      started += 1;
      if (started === 1) {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      }
    });
    const refresh = coalesceRefresh(fn);

    const first = refresh();
    const second = refresh();
    const third = refresh();
    expect(fn).toHaveBeenCalledTimes(1);

    releaseFirst!();
    await Promise.all([first, second, third]);
    // No trailing run: riding callers do not re-fire the batch.
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("a caller that arrives after the run finishes starts a fresh run", async () => {
    const fn = vi.fn(async () => {});
    const refresh = coalesceRefresh(fn);
    await refresh();
    await refresh();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("a rejected run does not poison later calls", async () => {
    let attempt = 0;
    const fn = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("network");
    });
    const refresh = coalesceRefresh(fn);

    await expect(refresh()).rejects.toThrow("network");
    await expect(refresh()).resolves.toBeUndefined();
  });

  it("callers always receive a promise, never undefined", async () => {
    const fn = vi.fn(async () => {});
    const refresh = coalesceRefresh(fn);
    const p = refresh();
    expect(p).toBeInstanceOf(Promise);
    await p;
  });
});
