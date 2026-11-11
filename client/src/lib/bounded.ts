/**
 * The deadline rule.
 *
 * A fetch to an unreachable host does not always fail -- it *hangs*. A stale
 * DHCP address on a network that blackholes packets never sends a RST, so the
 * request sits in CONNECT for tens of seconds or more. Every request that had
 * no bound could therefore leave a spinner running for good, and the one that
 * mattered most -- the reachability probe -- left the whole app on the
 * "Connecting…" splash with no way out. That is precisely the case the
 * offline path exists to handle: the point of downloading a book is to listen
 * to it with no network.
 *
 * So every request gets a deadline, and a request that runs out of time fails
 * like any other error -- which the callers already know how to show.
 *
 * The default is generous, because a slow home server on a phone is still a
 * working server.
 *
 * ## Why this is its own module
 *
 * Two applications need the deadline: the family client and the admin panel.
 * The admin panel is a **separate bundle** with its own credential and its own
 * route table (ADR 022), so it must not import `lib/api.ts` -- that would
 * drag the family's session handling, copy catalogue and private cache into
 * the panel's build.
 *
 * The rule is therefore here, with no application state in it, and
 * `lib/api.ts` composes it with the family's offline-mode check.
 */

/** How long a request may take before it is abandoned. */
export const REQUEST_TIMEOUT_MS = 30_000;

/** The `fetch` the deadline is built on. Injectable so the rule is testable. */
export type Fetcher = (input: RequestInfo | URL, init: RequestInit) => Promise<Response>;

/**
 * `fetch`, with a deadline.
 *
 * The signal is composed rather than replaced, so a caller that already set
 * one keeps it.
 *
 * The deadline is enforced **twice**, and both halves matter:
 *
 *  - the signal is aborted, which is what actually cancels a real request;
 *  - the promise is raced against the timer, so the call rejects even if the
 *    underlying fetch ignores its signal.
 *
 * Relying on the abort alone would mean the deadline is only as good as the
 * fetch implementation -- and a fetch that ignores its signal is exactly the
 * hang this exists to prevent.
 */
export async function fetchWithDeadline(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  fetcher: Fetcher = (url, options) => fetch(url, options),
): Promise<Response> {
  const controller = new AbortController();
  const outer = init.signal;

  // An already-aborted signal must not start a request at all.
  if (outer?.aborted) {
    controller.abort();
    throw abortError();
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(abortError());
    }, timeoutMs);
  });

  // The caller's own signal rejects the call as well as aborting it, so an
  // abort is felt immediately rather than whenever the request happens to
  // notice.
  const outerAbort = new Promise<never>((_resolve, reject) => {
    outer?.addEventListener("abort", () => {
      controller.abort();
      reject(abortError());
    });
  });

  try {
    return await Promise.race([
      fetcher(input, { ...init, signal: controller.signal }),
      deadline,
      outerAbort,
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * The error a deadline produces.
 *
 * Named `AbortError`, because that is what the browser's own `fetch` throws
 * when its signal fires -- and `isNetworkFailure` recognises that name, so an
 * abandoned request is reported as "the server could not be reached" rather
 * than as an unexplained failure.
 */
function abortError(): Error {
  if (typeof DOMException === "function") {
    return new DOMException("The operation was aborted.", "AbortError");
  }
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}
