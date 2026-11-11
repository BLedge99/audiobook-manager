/**
 * The background lock (spec 36).
 *
 * ## Why this exists
 *
 * The Android app clears its session token and its profile key after it has
 * been out of view for five minutes. That part was right: the profile should
 * not be readable by whoever picks the phone up.
 *
 * What was wrong was the consequence. The app cleared the token and then
 * carried on looking signed in, so every request failed with a 401 and the
 * app was unusable until it was restarted -- and restarting it is exactly what
 * the listener had to do to get the prompt they needed anyway.
 *
 * So the lock now does both halves: it clears the keys **and** returns the
 * app to the account gate, where the fingerprint prompt lives.
 *
 * ## Why it waits for playback
 *
 * The gate replaces the app, and the app is what holds the `<audio>` element.
 * Replacing it mid-book stops the audiobook.
 *
 * A listener who is listening is not browsing, and the thing the lock
 * protects -- the profile key and the private rows -- is not on screen while
 * the phone is in a pocket. So the lock waits for playback to finish, and
 * then does its job.
 */

/** How long the app may be out of view before it locks. */
export const BACKGROUND_LOCK_IDLE_MS = 5 * 60 * 1000;

/** How often the lock is reconsidered while the app is out of view. */
export const BACKGROUND_LOCK_CHECK_MS = 30 * 1000;

export interface LockDecisionInput {
  /** How long the app has been out of view. */
  hiddenForMs: number;
  /** The idle period after which the app locks. */
  idleMs: number;
  /** Whether an audiobook is playing right now. */
  audioPlaying: boolean;
}

/**
 * Whether the app should lock now.
 *
 * Three conditions, and all three must hold: the app has been out of view for
 * longer than the idle period, and nothing is playing.
 */
export function shouldLock({ hiddenForMs, idleMs, audioPlaying }: LockDecisionInput): boolean {
  if (audioPlaying) return false;
  return hiddenForMs >= idleMs;
}

/**
 * Whether an audiobook is playing right now.
 *
 * The app has exactly one `<audio>` element, and it lives in the player.
 * Asking the element is more honest than threading a "playing" flag up
 * through the player, the book page and the shell.
 */
export function isAudioPlaying(doc: Document | undefined = typeof document === "undefined" ? undefined : document): boolean {
  if (!doc) return false;
  const audio = doc.querySelector("audio");
  if (!audio) return false;
  return !audio.paused && !audio.ended;
}
