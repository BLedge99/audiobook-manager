/**
 * The service-worker update listener (spec: Render free-tier cold starts).
 *
 * With `skipWaiting` + `clientsClaim` configured in the production build, a
 * new service worker takes control the moment it is registered — but this app
 * never registers it on user navigation: unlocking the phone fires a visibility
 * change, the probe re-runs, the server wakes — and the page on screen is
 * still the version the old SW had in control.
 *
 * The fix: when control of this page passes to a newer worker (which happens
 * exactly once per SW update), reload the page so the listener sees the
 * current UI rather than a month-old frame.
 *
 * Unless the listener is mid-chapter (spec 42, phase 2): an update only ever
 * delays its reload to the first pause/end/error. It never lands mid-word,
 * and it fires at most once per update.
 */

import { isPlaybackActive, onPlaybackActiveChange } from "./lib/playbackSignal";

/**
 * Reload the page once a new service worker controls it — but not while
 * audio is audible. The reload is delivered at the first stop instead.
 *
 * `reload` is injectable so tests can observe it without `location` games.
 */
export function setupSwReload(reload: () => void = () => window.location.reload()): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  let reloaded = false;
  const fire = () => {
    if (reloaded) return;
    reloaded = true;
    // The new worker controls this page now; assets are loaded from the
    // fresh precache and a reload picks up their names.
    reload();
  };

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded) return;
    if (!isPlaybackActive()) {
      fire();
      return;
    }
    const unsubscribe = onPlaybackActiveChange((active) => {
      if (!active) {
        unsubscribe();
        fire();
      }
    });
  });
}
