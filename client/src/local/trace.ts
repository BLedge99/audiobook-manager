/**
 * Download pipeline tracing.
 *
 * ## Why this exists
 *
 * The download button used to sit at "Downloading 0%" forever with no message.
 * That symptom has one cause: a promise in the pipeline **never settled**. It
 * did not reject, so the button's catch block never ran, so `busy` stayed true
 * and nothing was ever shown. `try/catch` is useless against a promise that
 * hangs, which is why the fix has to be a timeout rather than better handling.
 *
 * Every stage of the pipeline is therefore wrapped in `step()`, which:
 *
 *  - logs the stage *before* awaiting, so a hang still shows where it stopped;
 *  - rejects with a named error if the stage exceeds its budget, instead of
 *    hanging forever;
 *  - accumulates a trace, so a failure deep in the pipeline reports everything
 *    that had already succeeded rather than just the last thing attempted.
 *
 * Deliberately dependency-free and side-effect-light so it is unit-testable in
 * jsdom without Capacitor or a server.
 */

export type StepStatus = "ok" | "fail" | "timeout";

export interface StepRecord {
  stage: string;
  ms: number;
  status: StepStatus;
  /** Short detail for a failure -- an error message, or the size that failed validation. */
  detail?: string;
}

/** Raised when a stage does not finish within its budget. */
export class DownloadStalledError extends Error {
  readonly stage: string;
  readonly budgetMs: number;
  readonly trace: StepRecord[];

  constructor(stage: string, budgetMs: number, trace: StepRecord[]) {
    super(`Stalled at "${stage}" (waited ${Math.round(budgetMs / 1000)}s). Steps completed: ${describe(trace)}`);
    this.name = "DownloadStalledError";
    this.stage = stage;
    this.budgetMs = budgetMs;
    this.trace = trace;
  }
}

function describe(records: StepRecord[]): string {
  if (!records.length) return "none";
  return records.map((r) => `${r.stage}${r.status === "ok" ? "" : `(${r.status})`}`).join(" -> ");
}

export class DownloadTrace {
  readonly records: StepRecord[] = [];

  constructor(private readonly log: (message: string) => void = (m) => console.log(`[download] ${m}`)) {}

  /**
   * Run one stage, failing loudly rather than silently.
   *
   * `budgetMs` is per stage, not for the whole download: a 30-hour audiobook is
   * many legitimate minutes, but any *single* step taking longer than its budget
   * means something is stuck, because every step here is a metadata write or a
   * single file transfer.
   */
  async step<T>(stage: string, budgetMs: number, run: () => Promise<T> | T): Promise<T> {
    this.log(`-> ${stage}`);
    const started = Date.now();
    try {
      const value = await withTimeout(Promise.resolve().then(run), budgetMs, stage, [...this.records]);
      const ms = Date.now() - started;
      this.records.push({ stage, ms, status: "ok" });
      this.log(`<- ${stage} ok in ${ms}ms`);
      return value;
    } catch (error) {
      const ms = Date.now() - started;
      const isStall = error instanceof DownloadStalledError;
      const detail = error instanceof Error ? error.message : String(error);
      this.records.push({ stage, ms, status: isStall ? "timeout" : "fail", detail });
      this.log(`<- ${stage} ${isStall ? "TIMEOUT" : "FAILED"} after ${ms}ms: ${detail}`);
      throw error;
    }
  }

  /** One-line summary for logs and the UI. */
  summary(): string {
    return this.records.map((r) => `${r.stage}: ${r.status} (${r.ms}ms)`).join("\n");
  }
}

function withTimeout<T>(promise: Promise<T>, budgetMs: number, stage: string, trace: StepRecord[]): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new DownloadStalledError(stage, budgetMs, trace)), budgetMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}