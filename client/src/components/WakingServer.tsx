import { LoaderCircle } from "lucide-react";
import { copy } from "../copy";

/**
 * The cold-start screen (Render free tier, mostly).
 *
 * The server is not absent — it is asleep, and it takes the better part of a
 * minute to wake. Showing the "unlock offline" screen here would be a lie
 * twice over: the listener would have nowhere to tap that helps (the only
 * button offered is about downloaded books), and they would wait forever for
 * an answer the app had already decided would never come.
 *
 * So this screen is the app saying what is actually happening and offering
 * the two things that can genuinely happen: wait for the server, or continue
 * offline.
 */
export function WakingServer({
  onRetry,
  onContinueOffline,
}: {
  /** Re-probe the server (shown while the wake probe is in flight or after it gave up). */
  onRetry: () => void;
  onContinueOffline: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 px-6 text-center">
      <LoaderCircle className="size-10 animate-spin text-cobalt-ink" aria-hidden="true" />
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink" role="status">
          {copy.waking.title}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-ink2">{copy.waking.body}</p>
      </div>
      <div className="grid w-full gap-3">
        <button type="button" onClick={onRetry} className="btn btn--glass w-full">
          {copy.waking.retry}
        </button>
        <button
          type="button"
          onClick={onContinueOffline}
          className="inline-flex w-full items-center justify-center text-sm font-bold text-cobalt-ink underline decoration-2 underline-offset-2"
        >
          {copy.waking.continueOffline}
        </button>
      </div>
    </main>
  );
}
