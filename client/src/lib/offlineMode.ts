/**
 * The offline-mode flag (spec 37, step 4.6).
 *
 * The listener's "listen without the server" choice used to live in three
 * homes at once: the App's state, the App's `localStorage` write, and the api
 * module's copy that the request interface read. Three writes, three readers,
 * one fact.
 *
 * Now one module owns it -- the value, the persistence, and the read. The App
 * writes through it; the request interface reads it.
 */

const STORAGE_KEY = "offlineMode";

let enabled = (() => {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
})();

/** The listener's explicit offline choice, as the app reads it. */
export function isOfflineMode(): boolean {
  return enabled;
}

/** Set the listener's offline choice, and remember it. */
export function setOfflineMode(next: boolean): void {
  enabled = next;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? "true" : "false");
  } catch {
    // Private mode / storage disabled
  }
}
