/**
 * Runtime platform detection (spec 26).
 *
 * ## Why `window.Capacitor` and not `@capacitor/core`
 *
 * The native bridge is injected at runtime, so during the first render the
 * `@capacitor/core` module import can hand back an uninitialised stub. Calling
 * into it then throws `Cannot read properties of undefined (reading
 * 'triggerEvent')`, which blanks the entire screen with no console error worth
 * trusting. Reading `window.Capacitor` defensively cannot throw.
 *
 * This started as a one-line helper in App.tsx and grew a second use (the API
 * base URL), so it now lives here rather than being imported from a component.
 */

/** True when running inside the Capacitor shell rather than a browser. */
export function isNativeShell(): boolean {
  if (typeof window === "undefined") return false;
  /**
   * Capacitor's native side injects `window.androidBridge` on Android and
   * `window.webkit.messageHandlers.bridge` on iOS *before* the web app loads.
   * These are set by the native bridge regardless of whether `@capacitor/core`
   * was imported -- which this app deliberately avoids doing at module scope
   * (see `local/device.ts`), because importing it before the bridge is ready
   * blanks the screen.
   *
   * Reading `window.Capacitor.isNativePlatform()` would not work here: that
   * object is only created by `@capacitor/core`'s module evaluation, which this
   * app never triggers. Mirror Capacitor's own `getPlatformId()` instead and
   * check the injected bridge directly.
   */
  const win = window as unknown as {
    androidBridge?: unknown;
    webkit?: { messageHandlers?: { bridge?: unknown } };
    Capacitor?: { isNativePlatform?: () => boolean };
  };
  return (
    !!win.androidBridge ||
    !!win.webkit?.messageHandlers?.bridge ||
    (typeof win.Capacitor?.isNativePlatform === "function" &&
      win.Capacitor.isNativePlatform())
  );
}