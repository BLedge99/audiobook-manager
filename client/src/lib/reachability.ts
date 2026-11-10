/**
 * Is the home server there?
 *
 * ## Why this is its own module
 *
 * Because the answer has to be *bounded*, and because the bound is the whole
 * point.
 *
 * A `fetch` to an unreachable host does not always fail. It **hangs**: a stale
 * DHCP address on a network that blackholes packets never sends a RST, so the
 * request sits in CONNECT until the browser's own timeout — tens of seconds, or
 * on some stacks, forever. With an unbounded probe, `serverReachable` stayed
 * `undefined` and the app sat on the splash showing "Connecting…" for good.
 *
 * That is precisely the case the offline path exists to handle: the point of
 * downloading a book is to listen to it with no network. A server that cannot
 * be reached must never be a screen the listener cannot leave.
 *
 * So the probe always resolves, one way or the other, within a bounded time.
 */

/** How long to wait for the server before deciding it is not there. */
export const PROBE_TIMEOUT_MS = 10_000;

export interface ServerProbe {
  /** Did the server answer at all? */
  reachable: boolean;
  /**
   * Did it accept us?
   *
   * Only meaningful when `reachable` is true. A 401 means the server is
   * *there* and wants a password, which is a different thing from the server
   * being absent.
   */
  authed: boolean;
}

/**
 * Ask the server whether it is there.
 *
 * Resolves within `timeoutMs` whatever happens: an answered request, a
 * refused one, or one that never comes back.
 */
export async function probeServer(timeoutMs: number = PROBE_TIMEOUT_MS): Promise<ServerProbe> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch("/api/audiobooks", { signal: controller.signal });
    return { reachable: true, authed: res.status !== 401 };
  } catch {
    // Rejected, aborted, or never answered. Either way: not there.
    return { reachable: false, authed: false };
  } finally {
    clearTimeout(timer);
  }
}
