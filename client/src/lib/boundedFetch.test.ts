import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { boundedFetch, REQUEST_TIMEOUT_MS } from "./api";

/**
 * Every request gets a deadline.
 *
 * A `fetch` to an unreachable host does not always fail — it **hangs**. A
 * stale DHCP address on a network that blackholes packets never sends a RST,
 * so the request sits in CONNECT for tens of seconds. Any spinner driven by an
 * unbounded request therefore spins for good, and the reachability probe left
 * the whole app on the "Connecting…" splash with no way out.
 *
 * The point of downloading a book is to listen to it with no network, so a
 * request that runs out of time has to fail like any other error — which the
 * callers already know how to show.
 */

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("boundedFetch", () => {
  it("passes the response through when the request answers", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const res = await boundedFetch("/api/audiobooks");
    expect(res.status).toBe(200);
  });

  it("gives up on a request that never answers", async () => {
    fetchMock.mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );

    // The rejection handler is attached **before** the clock advances. A
    // promise that rejects while nothing is listening to it is an unhandled
    // rejection, and Vitest reports those as errors that fail the whole run --
    // so attaching the assertion afterwards is not merely untidy, it turns a
    // green suite red.
    const pending = boundedFetch("/api/audiobooks", {}, 5_000);
    const rejection = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(4_999);
    // Still waiting: a slow server must not be cut off early.
    await vi.advanceTimersByTimeAsync(2);
    await rejection;
  });

  it("aborts the request it gave up on", async () => {
    let captured: AbortSignal | undefined;
    fetchMock.mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          captured = init?.signal ?? undefined;
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );

    const pending = boundedFetch("/api/audiobooks", {}, 1_000);
    const rejection = expect(pending).rejects.toThrow();
    expect(captured?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1_100);
    await rejection;
    expect(captured?.aborted).toBe(true);
  });

  it("keeps a caller's own abort signal", async () => {
    // A caller that already has a signal must keep control of it: the timeout
    // composes with it rather than replacing it.
    const outer = new AbortController();
    let captured: AbortSignal | undefined;
    fetchMock.mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          captured = init?.signal ?? undefined;
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );

    const pending = boundedFetch("/api/audiobooks", { signal: outer.signal }, 10_000);
    const rejection = expect(pending).rejects.toThrow();
    expect(captured).toBeDefined();
    expect(captured).not.toBe(outer.signal);

    outer.abort();
    await rejection;
  });

  it("has a default deadline long enough for a slow home server", () => {
    // Long enough that a working-but-slow server is never mistaken for an
    // absent one; short enough that a spinner cannot outlive the session.
    expect(REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000);
    expect(REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
  });
});
