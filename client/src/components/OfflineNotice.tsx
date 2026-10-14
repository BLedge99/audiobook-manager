import { useState } from "react";
import { CloudOff, RefreshCw, Wifi } from "lucide-react";

/**
 * Shown when the server cannot be reached **and** this device has nothing to
 * listen to.
 *
 * The important distinction from the login screen: this is not a failure to log
 * in. Telling someone to enter the household password when no server exists to
 * check it against is the bug this replaced -- it sent the user in a circle with
 * no way out. Here there is simply nothing offline yet, and the way to fix that
 * is to download something while the server is reachable.
 */
export function OfflineNotice({
  hasBooks,
  onRetry,
}: {
  /** Whether the device holds any downloaded books at all. */
  hasBooks: boolean;
  onRetry: () => void;
}) {
  const [checking, setChecking] = useState(false);

  const retry = () => {
    setChecking(true);
    onRetry();
    // The probe is a fetch; give it a moment before re-enabling the button so a
    // single tap does not fire five requests.
    window.setTimeout(() => setChecking(false), 2500);
  };

  return (
    <div className="grid min-h-screen place-items-center bg-[#0b1117] px-5 text-slate-100">
      <div className="w-full max-w-md border border-slate-800 bg-slate-900 p-8 text-center">
        <CloudOff className="mx-auto text-slate-500" size={32} aria-hidden="true" />
        <h1 className="mt-4 text-xl font-bold">Can&rsquo;t reach the server</h1>
        <p className="mt-2 text-sm text-slate-400">
          {hasBooks
            ? "Choose a profile to listen to the books already on this phone."
            : "Nothing has been downloaded to this phone yet. Connect to the home WiFi, open the app and download a book — then it will play with no network at all."}
        </p>
        <button
          type="button"
          onClick={retry}
          disabled={checking}
          className="mt-6 inline-flex items-center gap-2 bg-cyan-400 px-5 py-2 font-semibold text-slate-950 hover:bg-cyan-300 disabled:opacity-60"
        >
          {checking ? <RefreshCw size={16} className="animate-spin" /> : <Wifi size={16} />}
          {checking ? "Checking…" : "Try again"}
        </button>
      </div>
    </div>
  );
}

/**
 * Neutral waiting state for the first server probe.
 *
 * Deliberately not a login form: rendering one before the probe resolves flashes
 * a password box at someone who is merely on a slow connection.
 */
export function Splash() {
  return (
    <div className="grid min-h-screen place-items-center bg-[#0b1117] text-slate-500">
      <p className="text-sm">Connecting…</p>
    </div>
  );
}