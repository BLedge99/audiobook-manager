import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  BACKGROUND_LOCK_CHECK_MS,
  BACKGROUND_LOCK_IDLE_MS,
  isAudioPlaying,
  shouldLock,
  useBackgroundLock,
} from "./backgroundLock";

/**
 * Spec 36: the background lock.
 *
 * The lock used to clear the session token and then carry on looking signed
 * in, so every request failed with a 401 and the app was unusable until it
 * was restarted. These tests pin the decision: lock after the idle period,
 * but never while an audiobook is playing, because the gate replaces the app
 * and the app holds the audio element.
 */

describe("shouldLock", () => {
  it("locks once the app has been out of view for the idle period", () => {
    expect(
      shouldLock({
        hiddenForMs: BACKGROUND_LOCK_IDLE_MS,
        idleMs: BACKGROUND_LOCK_IDLE_MS,
        audioPlaying: false,
      }),
    ).toBe(true);
  });

  it("does not lock before the idle period", () => {
    expect(
      shouldLock({
        hiddenForMs: BACKGROUND_LOCK_IDLE_MS - 1,
        idleMs: BACKGROUND_LOCK_IDLE_MS,
        audioPlaying: false,
      }),
    ).toBe(false);
  });

  it("waits for playback to finish", () => {
    expect(
      shouldLock({
        hiddenForMs: BACKGROUND_LOCK_IDLE_MS * 10,
        idleMs: BACKGROUND_LOCK_IDLE_MS,
        audioPlaying: true,
      }),
    ).toBe(false);
  });
});

describe("isAudioPlaying", () => {
  it("is false when there is no audio element", () => {
    expect(isAudioPlaying(document)).toBe(false);
  });

  it("is true while an element is playing", () => {
    const audio = document.createElement("audio");
    Object.defineProperty(audio, "paused", { value: false, configurable: true });
    Object.defineProperty(audio, "ended", { value: false, configurable: true });
    document.body.appendChild(audio);
    expect(isAudioPlaying(document)).toBe(true);
    audio.remove();
  });

  it("is false for a paused or finished element", () => {
    const audio = document.createElement("audio");
    Object.defineProperty(audio, "paused", { value: true, configurable: true });
    Object.defineProperty(audio, "ended", { value: false, configurable: true });
    document.body.appendChild(audio);
    expect(isAudioPlaying(document)).toBe(false);

    Object.defineProperty(audio, "paused", { value: false, configurable: true });
    Object.defineProperty(audio, "ended", { value: true, configurable: true });
    expect(isAudioPlaying(document)).toBe(false);
    audio.remove();
  });
});

describe("the background lock sequence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears the session and returns to the gate", () => {
    const lock = vi.fn();
    const { unmount } = renderHook(() => useBackgroundLock({ enabled: true, lock }));

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    act(() => {
      vi.advanceTimersByTime(BACKGROUND_LOCK_IDLE_MS + 1);
    });

    expect(lock).toHaveBeenCalled();
    unmount();
  });

  it("waits for playback to finish before locking", () => {
    const lock = vi.fn();
    const { unmount } = renderHook(() => useBackgroundLock({ enabled: true, lock }));

    const audio = document.createElement("audio");
    Object.defineProperty(audio, "paused", { value: false, configurable: true });
    Object.defineProperty(audio, "ended", { value: false, configurable: true });
    document.body.appendChild(audio);
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    act(() => {
      vi.advanceTimersByTime(BACKGROUND_LOCK_IDLE_MS + 1);
    });
    // Still playing: the lock waits.
    expect(lock).not.toHaveBeenCalled();

    // Playback finishes, and the lock takes the app down.
    Object.defineProperty(audio, "paused", { value: true, configurable: true });
    Object.defineProperty(audio, "ended", { value: true, configurable: true });
    act(() => {
      vi.advanceTimersByTime(BACKGROUND_LOCK_CHECK_MS);
    });
    expect(lock).toHaveBeenCalled();

    audio.remove();
    unmount();
  });

  it("does nothing while the app is in view", () => {
    const lock = vi.fn();
    const { unmount } = renderHook(() => useBackgroundLock({ enabled: true, lock }));

    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    act(() => {
      vi.advanceTimersByTime(BACKGROUND_LOCK_IDLE_MS * 10);
    });

    expect(lock).not.toHaveBeenCalled();
    unmount();
  });
});
