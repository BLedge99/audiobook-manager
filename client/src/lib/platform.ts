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

interface CapacitorBridge {
  isNativePlatform?: () => boolean;
}

function bridge(): CapacitorBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { Capacitor?: CapacitorBridge }).Capacitor;
}

/** True when running inside the Capacitor shell rather than a browser. */
export function isNativeShell(): boolean {
  const native = bridge();
  return typeof native?.isNativePlatform === "function" && native.isNativePlatform();
}