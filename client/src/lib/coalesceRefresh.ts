/**
 * "Concurrent refreshes collapse" in one module.
 *
 * The same rule was written twice with different contracts — `useBrowse`
 * dropped mid-flight callers (they got `undefined`), `useLibrary` shared one
 * promise. This is the shared shape: callers ride the run already in flight.
 *
 * Semantics a caller can rely on:
 * - concurrent callers share the in-flight run (no duplicate batch);
 * - a call made after the run finishes starts a fresh run;
 * - a rejected run propagates to its callers and does not poison the next;
 * - callers always get a promise, never `undefined`.
 *
 * There is deliberately no trailing run: a caller that needs freshness after
 * the current run must say so itself (see `useLibrary.refreshForProfile`,
 * which invalidates ETags and re-fetches).
 */
export function coalesceRefresh(fn: () => Promise<void>): () => Promise<void> {
  let inFlight: Promise<void> | null = null;

  return function refresh(): Promise<void> {
    if (inFlight) return inFlight;
    const run = (async () => {
      try {
        await fn();
      } finally {
        inFlight = null;
      }
    })();
    inFlight = run;
    return run;
  };
}

