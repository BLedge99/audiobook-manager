/**
 * The wake budget (spec 42, phase 1) — one home for "how long does a cold
 * server take to answer".
 *
 * A free-tier (Render) instance sleeps and takes the better part of a minute
 * to wake. The app used to carry three independent copies of this fact: the
 * fast probe bound (`reachability.ts`), the patient wake probe
 * (`useSession.ts`) and the stream retry ladder (`ChapterPlayer.tsx`). Any of
 * them could drift without a test noticing.
 *
 * The contract is numeric and total: fast answers quickly, patient answers
 * eventually, and the stream ladder can outlast the patient probe. That is
 * all this module knows — no timers, no orchestration.
 */

/**
 * How long the fast probe may take before deciding the server is not there.
 * Long enough for a slow home server on a phone, short enough that the
 * offline path is reached before anyone gives up.
 */
export const FAST_PROBE_MS = 10_000;

/**
 * The patient probe: how long a cold instance may take before the app stops
 * waiting. While this probe runs the UI shows the waking screen.
 */
export const WAKE_TIMEOUT_MS = 75_000;

/**
 * The stream-retry ladder used when playback fails because the instance is
 * cold. Each step is a retry of the media load; landing on the last peak
 * means the instance came up. The total spend outlasts `WAKE_TIMEOUT_MS` —
 * pinned in `wakeBudget.test.ts`.
 */
export const WAKE_BACKOFF_MS: readonly number[] = [1_000, 3_000, 8_000, 20_000, 45_000];
