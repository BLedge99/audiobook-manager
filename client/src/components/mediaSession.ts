/**
 * Lock-screen and notification media controls.
 *
 * ## Why both a web and a native registration
 *
 * Android decided to show controls purely from the action bitmask on the
 * `PlaybackState` of the active `MediaSession` (verified with
 * `dumpsys media_session`: `actions=0`, `state=0`, `active item id=-1`). The
 * session existed but declared nothing, so the lock screen rendered the scrubber
 * and nothing else -- "just a squiggly line".
 *
 * Registering handlers on `navigator.mediaSession` alone was not enough: that
 * feeds the WebView's own session, and Chromium does not reliably propagate the
 * declared actions into the plugin's platform session. `@capgo/capacitor-media-
 * session` is the thing that owns the platform session, so its
 * `setActionHandler` is what actually sets the bitmask.
 *
 * Therefore both are registered. Whichever is unavailable is skipped silently --
 * in a browser there is no plugin, and on the web platform the plugin's web
 * implementation is not loaded.
 *
 * Never throws: a failure to decorate the lock screen must not stop playback.
 */

export type MediaHandlers = {
  play: () => void;
  pause: () => void;
  /** Seek backwards from the current position, in seconds. */
  seekBackward: () => void;
  /** Seek forwards from the current position, in seconds. */
  seekForward: () => void;
  /** Seek to a specific timestamp, in seconds. */
  seekTo?: (details: { seekTime?: number; fastSeek?: boolean }) => void;
  /** Previous chapter/track. */
  previousTrack?: () => void;
  /** Next chapter/track. */
  nextTrack?: () => void;
};

type CapPlugin = {
  setActionHandler: (options: { action: string }, handler: ((details: unknown) => void) | null) => Promise<void>;
  setPlaybackState?: (options: { playbackState: string }) => Promise<void>;
  setMetadata?: (options: { title?: string; artist?: string; album?: string }) => Promise<void>;
  setPositionState?: (options: { position: number; duration: number; playbackRate: number }) => Promise<void>;
};

/** The native plugin, or undefined when not running in the Android shell. */
function nativePlugin(): CapPlugin | undefined {
  const bridge = (globalThis as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor;
  return bridge?.Plugins?.MediaSession as CapPlugin | undefined;
}

function webSession(): MediaSession | undefined {
  return typeof navigator !== "undefined" && "mediaSession" in navigator ? navigator.mediaSession : undefined;
}

/**
 * Register the handlers and return a function that removes them.
 *
 * Every registration is individually guarded: `setActionHandler` throws
 * `NotSupportedError` for an action the platform does not implement, and one
 * unsupported action must not prevent the others being registered.
 */
export function registerMediaSessionHandlers(handlers: MediaHandlers): () => void {
  const web = webSession();
  const native = nativePlugin();

  const map: Array<[string, (details?: unknown) => void]> = [
    ["play", handlers.play],
    ["pause", handlers.pause],
    ["seekbackward", handlers.seekBackward],
    ["seekforward", handlers.seekForward],
    ["seekto", handlers.seekTo ? (details) => handlers.seekTo!(details as { seekTime?: number; fastSeek?: boolean }) : () => {}],
    ["previoustrack", handlers.previousTrack ?? (() => {})],
    ["nexttrack", handlers.nextTrack ?? (() => {})],
  ];

  for (const [action, handler] of map) {
    try {
      web?.setActionHandler(action as MediaSessionAction, handler);
    } catch {
      /* action unsupported on this platform */
    }
    try {
      void native?.setActionHandler({ action }, handler);
    } catch {
      /* plugin not present, or the action is unsupported */
    }
  }

  return () => {
    for (const [action] of map) {
      try {
        web?.setActionHandler(action as MediaSessionAction, null);
      } catch {
        /* noop */
      }
      try {
        void native?.setActionHandler({ action }, null);
      } catch {
        /* noop */
      }
    }
  };
}

/**
 * Push title/artist to the lock screen. Best-effort; never throws.
 *
 * Artwork is deliberately omitted. The plugin downloads the image with a
 * blocking `HttpURLConnection` on the plugin thread, and the only URLs it
 * accepts are http(s)/base64 -- not the `capacitor-file://` scheme downloaded
 * books use. Passing a cover would therefore stall this call for nothing.
 */
export function setMediaMetadata(title: string, artist?: string, album?: string): void {
  const session = webSession();
  if (session) {
    try {
      session.metadata = new MediaMetadata({ title, artist, album });
    } catch {
      /* noop */
    }
  }
  // The plugin keeps its own copy, and its was what left the lock screen with
  // `description=null` -- no title at all.
  try {
    void nativePlugin()?.setMetadata?.({ title, artist, album });
  } catch {
    /* noop */
  }
}

export type PlaybackStateName = "none" | "paused" | "playing";

/**
 * Tell the platform session what the audio element is doing.
 *
 * **This is what unlocks the play/pause buttons.** In the plugin's
 * `MediaSessionService.update()`:
 *
 * ```java
 * if ("play".equals(a)  && playbackState != STATE_PAUSED)  continue;
 * if ("pause".equals(a) && playbackState != STATE_PLAYING) continue;
 * ```
 *
 * Both transport actions are skipped unless the service's playback state
 * matches, and that state only changes through this method. The symptom was a
 * lock screen with a scrubber and no play/pause: `dumpsys` showed
 * `state=0` and `actions=120` -- seek_to|fast_forward|rewind|skip_to_previous,
 * i.e. every action that is *not* gated on playback state, and neither one that
 * is.
 */
export function publishPlaybackState(state: PlaybackStateName): void {
  const session = webSession();
  if (session) {
    try {
      session.playbackState = state;
    } catch {
      /* noop */
    }
  }
  try {
    void nativePlugin()?.setPlaybackState?.({ playbackState: state });
  } catch {
    /* noop */
  }
}

/**
 * Publish position so the lock screen can draw a scrubber that tracks.
 *
 * The `setInterval` is deliberate: Android only redraws the scrubber when it is
 * told, and `setPositionState` is the only way to tell it.
 */
export function publishPosition(get: () => { position: number; duration: number; rate: number }): () => void {
  const native = nativePlugin();
  if (!native || typeof native.setPositionState !== "function" || typeof window === "undefined") {
    return () => {};
  }

  const timer = window.setInterval(() => {
    const { position, duration, rate } = get();
    void native.setPositionState?.({ position, duration, playbackRate: rate });
  }, 1000);

  return () => window.clearInterval(timer);
}