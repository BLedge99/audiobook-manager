/**
 * The one boolean the app and the service-worker update listener both need:
 * is audio audible right now?
 *
 * A `controllerchange` means a new service worker took control — concretely,
 * a deploy landed. Reloading picks it up, but tearing down the audio element
 * mid-chapter is not acceptable collateral. The player publishes its state
 * here (spec 42, phase 2); `swUpdate` defers the reload to the first stop.
 *
 * This is deliberately not the media session's playback state (that one
 * dresses the lock screen). This one exists so a reload cannot land mid-word.
 */

let playing = false;
const listeners = new Set<(playing: boolean) => void>();

/** Publish whether audio is audible. Listeners fire only on actual changes. */
export function setPlaybackActive(value: boolean): void {
  if (playing === value) return;
  playing = value;
  for (const listener of [...listeners]) listener(playing);
}

/** The current playback state, for one-shot reads. */
export function isPlaybackActive(): boolean {
  return playing;
}

/** Subscribe to changes; returns the unsubscribe. */
export function onPlaybackActiveChange(callback: (playing: boolean) => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}
