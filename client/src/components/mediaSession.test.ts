import { afterEach, describe, expect, it, vi } from "vitest";
import {
  publishPlaybackState,
  publishPosition,
  registerMediaSessionHandlers,
  setMediaMetadata,
  type PlaybackStateName,
} from "./mediaSession";

/**
 * The bug: on Android the lock screen showed a scrubber and no transport buttons.
 *
 * `dumpsys media_session` showed the session existed but with `actions=0` --
 * Android renders controls purely from that bitmask. Registering on
 * `navigator.mediaSession` alone did not set it, so both paths must be used.
 */

/** Minimal stand-in for the web MediaSession. */
function stubWebSession() {
  const handlers = new Map<string, unknown>();
  const session = {
    metadata: null as unknown,
    playbackState: "none" as PlaybackStateName,
    setActionHandler: vi.fn((action: string, handler: unknown) => {
      handlers.set(action, handler);
    }),
  };
  Object.defineProperty(navigator, "mediaSession", { value: session, configurable: true, writable: true });
  return { session, handlers };
}

/** Minimal stand-in for the Capacitor plugin bridge. */
function stubPlugin() {
  const handlers = new Map<string, unknown>();
  const plugin = {
    setActionHandler: vi.fn(async ({ action }: { action: string }, handler: unknown) => {
      handlers.set(action, handler);
    }),
    setPositionState: vi.fn(async () => {}),
    setPlaybackState: vi.fn(async (_options: { playbackState: string }) => {}),
    setMetadata: vi.fn(async () => {}),
  };
  (globalThis as { Capacitor?: unknown }).Capacitor = { Plugins: { MediaSession: plugin } };
  return { plugin, handlers };
}

function clearPlugin() {
  delete (globalThis as { Capacitor?: unknown }).Capacitor;
}

afterEach(() => {
  clearPlugin();
  vi.useRealTimers();
});

describe("registerMediaSessionHandlers", () => {
  it("declares the actions on the native plugin, which is what sets Android's bitmask", () => {
    stubWebSession();
    const { plugin } = stubPlugin();

    registerMediaSessionHandlers({
      play: () => {},
      pause: () => {},
      seekBackward: () => {},
      seekForward: () => {},
    });

    const declared = plugin.setActionHandler.mock.calls.map((call) => (call[0] as { action: string }).action);
    expect(declared).toEqual(
      expect.arrayContaining(["play", "pause", "seekbackward", "seekforward", "previoustrack", "nexttrack"]),
    );
  });

  it("also registers on the web session for browsers and the PWA", () => {
    const { session } = stubWebSession();
    stubPlugin();

    registerMediaSessionHandlers({ play: () => {}, pause: () => {}, seekBackward: () => {}, seekForward: () => {} });

    expect(session.setActionHandler).toHaveBeenCalled();
  });

  it("invokes the given handler when the platform fires the action", () => {
    const { handlers } = stubWebSession();
    stubPlugin();
    const seekBackward = vi.fn();
    const seekTo = vi.fn();

    registerMediaSessionHandlers({ play: () => {}, pause: () => {}, seekBackward, seekForward: () => {}, seekTo });
    (handlers.get("seekbackward") as () => void)();
    (handlers.get("seekto") as (details: { seekTime: number }) => void)({ seekTime: 42 });

    expect(seekBackward).toHaveBeenCalledOnce();
    expect(seekTo).toHaveBeenCalledWith({ seekTime: 42 });
  });

  it("removes every handler on cleanup", () => {
    const { handlers, session } = stubWebSession();
    const { plugin } = stubPlugin();

    const unregister = registerMediaSessionHandlers({
      play: () => {},
      pause: () => {},
      seekBackward: () => {},
      seekForward: () => {},
    });
    unregister();

    expect([...handlers.values()].every((value) => value === null)).toBe(true);
    expect(plugin.setActionHandler).toHaveBeenLastCalledWith({ action: "nexttrack" }, null);
    expect(session.setActionHandler).toHaveBeenLastCalledWith("nexttrack", null);
  });

  it("does not throw when there is no media session at all", () => {
    // @ts-expect-error deleting a required DOM property for the test
    delete navigator.mediaSession;
    clearPlugin();
    expect(() =>
      registerMediaSessionHandlers({ play: () => {}, pause: () => {}, seekBackward: () => {}, seekForward: () => {} }),
    ).not.toThrow();
  });

  it("keeps registering the other actions when one is unsupported", () => {
    stubPlugin();
    const plugin = (
      globalThis as unknown as { Capacitor: { Plugins: { MediaSession: { setActionHandler: unknown } } } }
    ).Capacitor.Plugins.MediaSession;
    // Android throws NotSupportedError for actions it does not implement.
    plugin.setActionHandler = vi.fn(({ action }: { action: string }) => {
      if (action === "seekforward") throw new Error("NotSupportedError");
    });

    const { handlers } = stubWebSession();
    expect(() =>
      registerMediaSessionHandlers({ play: () => {}, pause: () => {}, seekBackward: () => {}, seekForward: () => {} }),
    ).not.toThrow();
    expect(handlers.get("play")).toBeTypeOf("function");
  });
});

describe("setMediaMetadata", () => {
  // jsdom does not implement MediaMetadata; Chromium (and therefore the Android
  // WebView) does. Stub it so the assigned value is inspectable.
  function stubMediaMetadata() {
    class Stub {
      constructor(public init: Record<string, unknown>) {}
    }
    (globalThis as { MediaMetadata?: unknown }).MediaMetadata = Stub;
  }

  afterEach(() => {
    delete (globalThis as { MediaMetadata?: unknown }).MediaMetadata;
  });

  it("pushes title and author to the lock screen", () => {
    stubMediaMetadata();
    const { session } = stubWebSession();
    setMediaMetadata("Chapter 3", "Narrator", "The Book");
    expect((session.metadata as { init: Record<string, unknown> }).init).toMatchObject({
      title: "Chapter 3",
      artist: "Narrator",
      album: "The Book",
    });
  });

  it("swallows a missing MediaMetadata rather than breaking playback", () => {
    stubWebSession();
    (globalThis as { MediaMetadata?: unknown }).MediaMetadata = undefined;
    expect(() => setMediaMetadata("Chapter 3")).not.toThrow();
  });
});

describe("publishPlaybackState", () => {
  // The plugin gates the play/pause buttons on this value
  // (MediaSessionService.update skips "play" unless state == STATE_PAUSED, and
  // "pause" unless STATE_PLAYING). Without it the lock screen shows no transport
  // buttons at all -- `dumpsys` gave `state=0, actions=120`, seek bits only.
  it("sends each state the plugin understands and updates the web media session", () => {
    const { session } = stubWebSession();
    const { plugin } = stubPlugin();
    publishPlaybackState("playing");
    expect(session.playbackState).toBe("playing");
    publishPlaybackState("paused");
    expect(session.playbackState).toBe("paused");
    publishPlaybackState("none");
    expect(session.playbackState).toBe("none");

    const sent = plugin.setPlaybackState.mock.calls.map((call) => (call[0] as { playbackState: string }).playbackState);
    expect(sent).toEqual(["playing", "paused", "none"]);
  });

  it("is a no-op in a browser rather than throwing", () => {
    clearPlugin();
    expect(() => publishPlaybackState("playing")).not.toThrow();
  });
});

describe("publishPosition", () => {
  it("pushes position, duration and rate once a second", () => {
    vi.useFakeTimers();
    stubPlugin();
    const { plugin } = stubPlugin();
    const stop = publishPosition(() => ({ position: 12, duration: 300, rate: 1.5 }));

    vi.advanceTimersByTime(1000);
    expect(plugin.setPositionState).toHaveBeenCalledWith({ position: 12, duration: 300, playbackRate: 1.5 });

    vi.advanceTimersByTime(1000);
    expect(plugin.setPositionState).toHaveBeenCalledTimes(2);

    stop();
    vi.advanceTimersByTime(5000);
    expect(plugin.setPositionState).toHaveBeenCalledTimes(2);
  });

  it("is a no-op without the plugin, so browsers do not get a stray timer", () => {
    vi.useFakeTimers();
    clearPlugin();
    const stop = publishPosition(() => ({ position: 0, duration: 0, rate: 0 }));
    expect(vi.getTimerCount()).toBe(0);
    expect(() => stop()).not.toThrow();
  });
});