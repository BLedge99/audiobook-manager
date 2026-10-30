import { describe, it, expect } from "vitest";
import { DownloadStalledError, DownloadTrace } from "./trace";

/**
 * The download button used to sit at "Downloading 0%" forever. The cause was a
 * promise that never settled -- so `catch` never ran, `busy` stayed true and
 * nothing was ever displayed. `try/catch` cannot help with a hang; only a
 * deadline can. These tests pin that behaviour, especially the timeout path.
 */
describe("DownloadTrace", () => {
  it("returns the value of a successful step and records it", async () => {
    const trace = new DownloadTrace(() => {});
    await expect(trace.step("do work", 1000, () => 42)).resolves.toBe(42);
    expect(trace.records).toHaveLength(1);
    expect(trace.records[0]).toMatchObject({ stage: "do work", status: "ok" });
  });

  it("awaits async work", async () => {
    const trace = new DownloadTrace(() => {});
    await expect(trace.step("async", 1000, async () => "done")).resolves.toBe("done");
  });

  it("records a rejection and rethrows the original error", async () => {
    const trace = new DownloadTrace(() => {});
    const boom = new Error("plugin exploded");
    await expect(trace.step("risky", 1000, () => { throw boom; })).rejects.toBe(boom);
    expect(trace.records[0]).toMatchObject({ stage: "risky", status: "fail" });
    expect(trace.records[0].detail).toContain("plugin exploded");
  });

  // The regression that motivated this whole module.
  it("times out a promise that never settles, and says which stage", async () => {
    const trace = new DownloadTrace(() => {});
    // A promise that never resolves -- the exact shape of the original bug.
    const never = new Promise<void>(() => {});
    const error = await trace.step("hangs forever", 20, () => never).catch((e) => e);

    expect(error).toBeInstanceOf(DownloadStalledError);
    expect((error as DownloadStalledError).stage).toBe("hangs forever");
    expect((error as Error).message).toMatch(/stalled at "hangs forever"/i);
    expect(trace.records[0].status).toBe("timeout");
  });

  it("includes the stages that already succeeded in the timeout message", async () => {
    const trace = new DownloadTrace(() => {});
    await trace.step("first", 1000, () => {});
    await trace.step("second", 1000, () => {});
    const error = await trace
      .step("third", 20, () => new Promise<void>(() => {}))
      .then(() => undefined)
      .catch((e: unknown) => e as Error);

    expect(error!.message).toContain("first");
    expect(error!.message).toContain("second");
    expect(error!.message).toContain("third");
  });

  it("keeps working after a failure, so a retry starts clean", async () => {
    const trace = new DownloadTrace(() => {});
    await trace.step("bad", 1000, () => { throw new Error("nope"); }).catch(() => {});
    await expect(trace.step("good", 1000, () => "ok")).resolves.toBe("ok");
    expect(trace.records).toHaveLength(2);
  });

  it("logs the stage before running it, so a hang is still visible", async () => {
    const lines: string[] = [];
    const trace = new DownloadTrace((m) => lines.push(m));
    await trace.step("announced", 1000, () => {});
    expect(lines[0]).toContain("-> announced");
    expect(lines[1]).toContain("<- announced");
  });

  it("summarises every stage for the UI", async () => {
    const trace = new DownloadTrace(() => {});
    await trace.step("one", 1000, () => {});
    await trace.step("two", 1000, () => { throw new Error("x"); }).catch(() => {});
    const summary = trace.summary();
    expect(summary).toContain("one: ok");
    expect(summary).toContain("two: fail");
  });
});

describe("DownloadStalledError", () => {
  it("is an Error so existing catch blocks handle it", () => {
    expect(new DownloadStalledError("s", 1000, [])).toBeInstanceOf(Error);
  });
});