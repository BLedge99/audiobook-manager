/**
 * Connection status indicator.
 *
 * Shows the listener what state the app is in:
 * - Offline mode (user explicitly chose offline)
 * - Connecting (probing server)
 * - Server unreachable (network error)
 * - Connected (no indicator shown)
 *
 * Used in the header so the listener always knows whether they're online or offline.
 */
export function ConnectionStatus({
  offlineMode,
  serverReachable,
}: {
  /** True when user has explicitly chosen offline mode. */
  offlineMode: boolean;
  /** Whether the server could be reached on the last probe. */
  serverReachable: boolean | undefined;
}) {
  // In offline mode, always show offline indicator
  if (offlineMode) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-ink2">
        <span className="inline-block size-1.5 rounded-full bg-ink/40" />
        Offline
      </span>
    );
  }

  // Server reachability unknown - still connecting
  if (serverReachable === undefined) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-ink2">
        <span className="inline-block size-1.5 rounded-full bg-ink/40 animate-pulse" />
        Connecting…
      </span>
    );
  }

  // Server unreachable
  if (serverReachable === false) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-rasp">
        <span className="inline-block size-1.5 rounded-full bg-rasp/20" />
        Server unreachable
      </span>
    );
  }

  // Connected - no indicator needed
  return null;
}
