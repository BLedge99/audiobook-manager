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
 * current UI rather than a month-old frame. The guard flag is per page — the
 * navigation after reload loads the new assets directly, so the listener
 * fires at most once per update, not in a loop.
 */

let reloaded = false;

export function setupSwReload(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded) return;
    reloaded = true;
    // The new worker controls this page now; assets are loaded from the
    // fresh precache and a reload picks up their names.
    window.location.reload();
  });
}
