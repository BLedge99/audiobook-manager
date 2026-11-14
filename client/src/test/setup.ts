/**
 * Vitest setup for the client suite.
 *
 * `vite.config.ts` names this file, so every test starts with:
 *
 * - the `jest-dom` matchers (`toBeInTheDocument`, `toHaveAccessibleName`, ...),
 *   which is what the component tests assert with, and
 * - an in-memory IndexedDB (`fake-indexeddb/auto`), because jsdom has none and
 *   the local replica and download tests exercise Dexie for real rather than
 *   through a mock.
 *
 * The file lives in `src/test/`, which the repository's `.gitignore` used to
 * swallow (a bare `test/` pattern matched it at any depth). It is tracked now;
 * if `npm test` reports "Cannot find module ./src/test/setup.ts", that is the
 * ignore pattern regressing, not this file disappearing.
 */
import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";

/**
 * jsdom has no `window.matchMedia`, and the theme resolver reads it to watch
 * `prefers-color-scheme`. Without a stub, every test that mounts the app with
 * the `auto` theme crashes with `window.matchMedia is not a function` — the
 * failure used to pass or fail depending on test ordering. A minimal but
 * honest stub: `matches` is `false` (light scheme, like a dumb shell), it
 * implements the modern `addEventListener`/`removeEventListener` interface
 * the theme code uses, and it never actually fires a change event.
 */
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string): MediaQueryList => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const mql: MediaQueryList = {
      matches: false,
      media: query,
      onchange: null,
      addEventListener: (_type: string, cb: (event: MediaQueryListEvent) => void) => { listeners.add(cb); },
      removeEventListener: (_type: string, cb: (event: MediaQueryListEvent) => void) => { listeners.delete(cb); },
      addListener: (cb: (event: MediaQueryListEvent) => void) => { listeners.add(cb); },
      removeListener: (cb: (event: MediaQueryListEvent) => void) => { listeners.delete(cb); },
      dispatchEvent: () => true,
    } as unknown as MediaQueryList;
    return mql;
  };
}

/**
 * Polyfill HTMLMediaElement methods that jsdom doesn't implement.
 * This prevents "Not implemented: HTMLMediaElement.prototype.pause/load" errors
 * in tests that render audio/video elements.
 */
if (typeof HTMLMediaElement !== "undefined") {
  const noop = () => {};
  const props: Array<keyof HTMLMediaElement> = ["play", "pause", "load", "canPlayType", "addTextTrack"];
  for (const prop of props) {
    // @ts-expect-error - polyfilling unimplemented methods
    HTMLMediaElement.prototype[prop] = noop;
  }
  // Mock properties that are read
  Object.defineProperty(HTMLMediaElement.prototype, "duration", { value: 0, writable: true });
  Object.defineProperty(HTMLMediaElement.prototype, "currentTime", { value: 0, writable: true });
  Object.defineProperty(HTMLMediaElement.prototype, "paused", { value: true, writable: true });
  Object.defineProperty(HTMLMediaElement.prototype, "ended", { value: false, writable: true });
  Object.defineProperty(HTMLMediaElement.prototype, "readyState", { value: 4, writable: true });
  Object.defineProperty(HTMLMediaElement.prototype, "networkState", { value: 0, writable: true });
  Object.defineProperty(HTMLMediaElement.prototype, "volume", { value: 1, writable: true });
  Object.defineProperty(HTMLMediaElement.prototype, "muted", { value: false, writable: true });
}
