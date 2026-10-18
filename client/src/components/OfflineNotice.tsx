import { useState } from "react";
import { CloudOff, RefreshCw, Wifi } from "lucide-react";
import { Btn, FullScreen, MachineMark, Wordmark } from "../ui/primitives";

/**
 * Shown when the server cannot be reached **and** this device has nothing to
 * listen to.
 *
 * The important distinction from the login screen: this is not a failure to log
 * in. Telling someone to enter the household password when no server exists to
 * check it against is the bug this replaced -- it sent the user in a circle with
 * no way out. Here there is simply nothing offline yet, and the way to fix that
 * is to download something while the server is reachable.
 *
 * The reassurance is the most important thing on this screen, so it gets the
 * largest type on the page. A retry button in a dead end is not comfort.
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
    <FullScreen>
      <div className="flex flex-col items-center text-center">
        <Wordmark title="Audiobook Manager" subtitle="local-first listening" />

        <div className="panel mt-8 w-full px-6 py-7">
          <span className="mx-auto grid size-16 -rotate-6 place-items-center rounded-[20px_16px_20px_16px/16px_20px_16px_20px] border-2 border-ink bg-sunk">
            <CloudOff size={28} aria-hidden="true" className="text-ink3" />
          </span>

          <h1 className="mt-5 font-display text-2xl font-semibold text-ink">Can&rsquo;t reach the server</h1>

          <p className="mx-auto mt-3 max-w-sm text-[15px] leading-relaxed text-ink2">
            {hasBooks
              ? "Choose a profile to listen to the books already on this phone."
              : "Nothing has been downloaded to this phone yet. Connect to the home WiFi, open the app and download a book — then it will play with no network at all."}
          </p>

          <Btn variant="primary" onClick={retry} disabled={checking} className="mt-6 w-full sm:w-auto">
            {checking ? <RefreshCw size={16} className="animate-spin" aria-hidden="true" /> : <Wifi size={16} aria-hidden="true" />}
            {checking ? "Checking…" : "Try again"}
          </Btn>
        </div>
      </div>
    </FullScreen>
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
    <FullScreen>
      <div className="flex flex-col items-center text-center">
        {/* The mark breathes rather than a bare word: it tells the listener the
            app opened and is working, which is the only question this screen is
            answering. */}
        <MachineMark className="dispense" />
        <p className="mt-6 text-sm font-bold text-ink3">Connecting…</p>
      </div>
    </FullScreen>
  );
}