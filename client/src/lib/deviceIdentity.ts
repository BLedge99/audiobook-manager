/**
 * Naming and identifying this device (spec 36).
 *
 * ## Why this exists
 *
 * The "Signed-in devices" panel used to say "Android device" for every phone,
 * because "Android device" is all the user agent says. A household with two
 * Android phones could not tell them apart, and the panel could not tell the
 * same phone from a second one.
 *
 * Two things fix that:
 *
 *  - the Android WebView's user agent carries the model, so the phone can name
 *    itself ("Pixel 4a");
 *  - a stable installation id, generated once and kept in `localStorage`, lets
 *    the server tell two phones apart and lets a phone that re-enrols keep the
 *    same identity.
 *
 * The installation id **names** a device. It authorises nothing: the server
 * anchors a session to the device credential it was minted from, and only the
 * server can mint one of those.
 */

/** Where the installation id is kept between launches. */
export const INSTALLATION_ID_KEY = "deviceId";

/**
 * The phone's model, read from the user agent.
 *
 * The Android WebView's user agent looks like this:
 *
 * ```
 * Mozilla/5.0 (Linux; Android 13; Pixel 4a Build/TQ3A.230805.001; wv) ...
 * ```
 *
 * The model sits between the Android version and the build number, and it can
 * contain a space ("Pixel 4a") or not ("SM-S911B"), so the pattern stops at
 * the build number rather than at the first space.
 *
 * Returns null for anything that is not an Android user agent, so the caller
 * can fall back to whatever the server derives.
 */
export function deviceNameFromUserAgent(
  userAgent: string | null | undefined,
): string | null {
  if (!userAgent) return null;
  const match =
    /Android[^;]*;\s*([^;)]+?)(?:\s+Build\/[^;)]*)?(?:\s*;[^)]*)?\)/.exec(userAgent);
  const name = match?.[1]?.trim();
  if (!name) return null;
  // A model name is short. Anything longer is a user agent in disguise.
  return name.length <= 60 ? name : null;
}

/**
 * A fresh random identifier.
 *
 * `crypto.randomUUID` needs a secure context, which the Android WebView has
 * (`https://localhost`), but an older WebView may not have it, so
 * `getRandomValues` is the fallback. An empty string means there is no
 * crypto available at all, and the caller simply sends no device id.
 */
export function newInstallationId(): string {
  const cryptoApi = typeof globalThis === "undefined" ? undefined : globalThis.crypto;
  if (!cryptoApi) return "";
  if (typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  if (typeof cryptoApi.getRandomValues === "function") {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return "";
}

/**
 * This installation's id, created on the first call and kept afterwards.
 *
 * It survives an app restart and an app update. It does not survive the
 * listener clearing the app's data, which is the right answer: that is a new
 * installation, and the old device credential is orphaned anyway.
 */
export function getInstallationId(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = window.localStorage.getItem(INSTALLATION_ID_KEY);
    if (existing) return existing;
    const created = newInstallationId();
    if (!created) return "";
    window.localStorage.setItem(INSTALLATION_ID_KEY, created);
    return created;
  } catch {
    // Private mode or storage disabled. The device is still identified by its
    // credential; it just cannot be told apart from another installation.
    return "";
  }
}

/**
 * What to call this device in the signed-in devices panel.
 *
 * The phone's own model if the user agent carries one, and otherwise a
 * generic fallback. The server prefers the enrolled label, so this is only
 * the value sent at enrolment time.
 */
export function deviceName(fallback: string): string {
  if (typeof navigator === "undefined") return fallback;
  return deviceNameFromUserAgent(navigator.userAgent) ?? fallback;
}
