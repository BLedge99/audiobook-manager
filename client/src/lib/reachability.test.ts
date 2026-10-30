import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { probeServer, PROBE_TIMEOUT_MS } from "./reachability";

/**
 * The offline path, and the hang that used to break it.
 *
 * The point of downloading a book is to listen to it with no network. So a
 * server that cannot be reached must never be a screen the listener cannot
 * leave.
 *
 * The failure this pins: a `fetch` to an unreachable host does not always
 * fail. It **hangs** — a stale DHCP address on a network that blackholes
 * packets never sends a RST, so the request sits in CONNECT for tens of
 * seconds. With an unbounded probe, `serverReachable` stayed `undefined` and
 * the app sat on the splash showing "Connecting…" for good.
 *
 * So the probe must always resolve, one way or the other, within a bounded
 * time. That is the whole contract.
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

/** A response shaped like the ones the app reads. */
function response(status: number) {
  return { ok: status >= 200 && status < 300, status } as unknown as Response;
}

describe("probeServer", () => {
  it("reports a server that answers", async () => {
    fetchMock.mockResolvedValue(response(200));
    await expect(probeServer()).resolves.toEqual({ reachable: true, authed: true });
  });

  it("reports a server that wants a password as reachable but not authed", async () => {
    // The distinction matters: a 401 is the server *answering*, so the login
    // gate is the right screen. Unreachable is the offline screen.
    fetchMock.mockResolvedValue(response(401));
    await expect(probeServer()).resolves.toEqual({ reachable: true, authed: false });
  });

  it("reports a refused connection as unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("Failed to fetch"));
    await expect(probeServer()).resolves.toEqual({ reachable: false, authed: false });
  });

  it("gives up on a server that never answers", async () => {
    // The bug. This fetch never settles -- not a rejection, just silence.
    fetchMock.mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );

    const pending = probeServer(5_000);
    // Ten seconds of nothing, and the app is still on the splash.
    await vi.advanceTimersByTimeAsync(4_999);
    await expect(PROBE_TIMEOUT_MS).toBeGreaterThan(0);

    // Then the timeout fires and the answer finally arrives.
    await vi.advanceTimersByTimeAsync(2);
    await expect(pending).resolves.toEqual({ reachable: false, authed: false });
  });

  it("passes an abort signal, so the request is actually cancelled", async () => {
    let captured: AbortSignal | undefined;
    fetchMock.mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          captured = init?.signal ?? undefined;
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );

    const pending = probeServer(1_000);
    expect(captured).toBeDefined();
    expect(captured?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1_100);
    await expect(pending).resolves.toEqual({ reachable: false, authed: false });
    expect(captured?.aborted).toBe(true);
  });

  it("has a timeout short enough that a person does not think it is broken", () => {
    // Long enough for a slow home server on a phone, short enough that the
    // offline path is reached before anyone gives up.
    expect(PROBE_TIMEOUT_MS).toBeLessThanOrEqual(15_000);
    expect(PROBE_TIMEOUT_MS).toBeGreaterThanOrEqual(3_000);
  });
});
