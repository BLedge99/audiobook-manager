import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setupSwReload } from "./swUpdate";
import { setPlaybackActive } from "./lib/playbackSignal";

/**
 * Spec 42, phase 2 — an update that lands mid-chapter must not stop the book.
 *
 * With `skipWaiting` + `clientsClaim` in the production build, a new service
 * worker takes control the moment it is registered. Reloading on that signal
 * is how the listener stops seeing a stale UI — but reloading mid-playback
 * tears down the audio element, and a deploy landing during a listening
 * session is the common case on a free-tier host that redeploys on every push.
 *
 * The contract: `controllerchange` while audio is audible defers the reload to
 * the first stop (pause/ended/error); it never lands mid-chapter.
 */

let fireControllerChange: (() => void) | undefined;
const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");

beforeEach(() => {
  setPlaybackActive(false);
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    get: () => ({
      addEventListener: (_event: string, callback: () => void) => {
        fireControllerChange = callback;
      },
    }),
  });
});

afterEach(() => {
  if (originalServiceWorker) Object.defineProperty(navigator, "serviceWorker", originalServiceWorker);
  else delete (navigator as unknown as Record<string, unknown>)["serviceWorker"];
  setPlaybackActive(false);
});

describe("setupSwReload", () => {
  it("reloads when nothing is playing", () => {
    const reload = vi.fn();
    setupSwReload(reload);

    fireControllerChange?.();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload mid-playback; reloads at the first stop", () => {
    const reload = vi.fn();
    setupSwReload(reload);
    setPlaybackActive(true);

    fireControllerChange?.();
    expect(reload).not.toHaveBeenCalled();

    setPlaybackActive(false); // the listener pauses / the chapter ends / playback errors
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("fires at most once, however often playback stops afterwards", () => {
    const reload = vi.fn();
    setupSwReload(reload);
    setPlaybackActive(true);

    fireControllerChange?.();
    setPlaybackActive(false);
    setPlaybackActive(true);
    setPlaybackActive(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("keeps the pending reload across a play→pause→play→pause stutter", () => {
    const reload = vi.fn();
    setupSwReload(reload);
    setPlaybackActive(true);

    fireControllerChange?.();
    setPlaybackActive(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
