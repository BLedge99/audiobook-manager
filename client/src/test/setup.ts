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
 * Polyfill HTMLMediaElement methods that jsdom doesn't implement.
 * This prevents "Not implemented: HTMLMediaElement.prototype.pause/load" errors
 * in tests that render audio/video elements.
 */
if (typeof HTMLMediaElement !== "undefined") {
  const noop = () => {};
  const props = ["play", "pause", "load", "canPlayType", "addTextTrack"];
  for (const prop of props) {
    if (typeof HTMLMediaElement.prototype[prop] === "undefined") {
      HTMLMediaElement.prototype[prop] = noop;
    }
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
