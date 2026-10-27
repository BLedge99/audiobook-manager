import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import type { Audiobook } from "../types";
import { getActiveProfileId, profileHeaders } from "../lib/api";
import { cacheProgress, readProgress } from "../local/privateCache";
import { copy } from "../copy";
import { ProgressTimeline } from "./ProgressTimeline";
import { Btn, Dome } from "../ui/primitives";
import { publishPlaybackState, publishPosition, registerMediaSessionHandlers, setMediaMetadata } from "./mediaSession";
import {
  clamp,
  describePosition,
  locateSegment,
  parseSegments,
  remainingLabel,
  timeLabel,
  totalDuration as computeTotalDuration,
} from "../lib/position";
import {
  bookPositionFromSource,
  nextSegmentIndex,
  planPosition,
  planSegment,
  previousSegmentIndex,
  segmentEnd,
} from "../lib/playback";
import { usePlayerSource } from "../lib/usePlayerSource";

/**
 * The audiobook player.
 *
 * ## The one idea in here
 *
 * **The state is the listening position, not the media source.** Everything
 * else -- which file is loaded, where in that file the playhead goes, whether
 * the element should be playing -- is derived from the position by
 * `lib/playback`.
 *
 * That distinction is the whole history of this component. See
 * decisions/017-player-state-is-position.md:
 *
 * - A book of many files used to "advance" by changing the source URL. That
 *   works, because every track is a different URL.
 * - A book of one file with embedded chapters has the *same* URL for all of
 *   them, so nothing changes when a chapter ends and nothing happened. The
 *   `onEnded` patch that was supposed to fix it was unreachable: `ended` only
 *   fires at the end of the file, by which time the position is in the last
 *   chapter.
 * - Trying to keep both in one component by special-casing chapter books gave
 *   five overlapping "pending seek" refs, a playhead that snapped back to zero
 *   before seeking, and a source that could never be set at all in the Android
 *   shell.
 *
 * So: one `pending` position, one `goTo(position, { play })` transport
 * primitive, one load effect. A seek within the loaded file is a
 * `currentTime` write; a seek into a different file is a source change, and
 * the load effect re-applies the *same* position once the new file has
 * metadata. Neither path can drag the readout backwards, because the readout
 * shows the requested position until the element has actually reached it.
 *
 * Everything the listener had before is still here: resume from the server or
 * the encrypted cache, periodic saves plus a session flush, 15-second skips,
 * speed, the sleep timer including "end of chapter", the chapter list, the
 * timeline, lock-screen controls, downloaded playback and native media tokens.
 */

type PlayerActions = {
  goTo: (target: number, options?: { play?: boolean }) => void;
  togglePlayback: (force?: boolean) => void;
  skipSeconds: (delta: number) => void;
  skipSegment: (delta: number) => void;
  saveProgress: (position: number, onSettled?: () => void, completed?: boolean) => void;
  flushSession: (toPosition: number) => void;
  openSession: (fromPosition: number) => void;
};

/** Seconds moved by the in-app and lock-screen skip buttons, together. */
const SKIP_SECONDS = 15;

/**
 * How long a requested position may stay "pending" before the element's own
 * position wins. Long enough for a slow track swap on a phone, short enough
 * that a seek the browser silently ignored does not freeze the readout.
 */
const PENDING_TIMEOUT_MS = 5000;

/**
 * @param localUrlForTrack Resolve a downloaded track to a playable local URL
 *   (spec 26, Sprint 2). Optional: absent in the PWA and the browser dev app,
 *   which have no device library.
 * @param profileId The signed-in profile. The player must not start without
 *   one -- progress is saved per profile -- and taking it from the app rather
 *   than from storage means a session restored from a cookie is not refused.
 *   Falls back to the stored id so the component still works standalone.
 */
export function ChapterPlayer({
  book,
  onProgressSaved,
  localUrlForTrack,
  profileId,
}: {
  book: Audiobook;
  onProgressSaved?: () => void;
  localUrlForTrack?: (bookId: number, trackId: number) => Promise<string | undefined>;
  profileId?: string | number | null;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const actionsRef = useRef<PlayerActions | null>(null);
  // Held in a ref so the unmount effect can keep its `[]` dependency list while
  // still calling the latest callback.
  const onProgressSavedRef = useRef(onProgressSaved);
  onProgressSavedRef.current = onProgressSaved;

  const activeProfileId = profileId === undefined
    ? getActiveProfileId()
    : profileId === null
      ? null
      : String(profileId);

  // Segment maths lives in lib/position, and the position->source mapping in
  // lib/playback, so the GUI (spec 15) can restyle this without reimplementing
  // either.
  const { segments, kind } = useMemo(() => parseSegments(book), [book]);
  const total = useMemo(() => computeTotalDuration(book, segments), [book, segments]);

  /**
   * The authoritative listening position, in book seconds.
   *
   * `position` is where the element actually is. `pending` is where the
   * listener asked to be and the seek has not landed yet. The UI shows
   * `pending ?? position`, which is why a cross-file seek never flashes back
   * to the start of the old file: the requested target is what is displayed
   * until the element has caught up.
   */
  const [position, setPosition] = useState(0);
  const [pending, setPending] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  /**
   * Whether playback should be running. Separate from `playing` (the element's
   * own state) because a source change pauses the element: the intent is what
   * tells the load effect to resume afterwards, so advancing to the next track
   * cannot depend on which render happened to change the URL.
   */
  const [playIntent, setPlayIntent] = useState(false);
  const [error, setError] = useState("");
  const [speed, setSpeed] = useState<number>(() => Number(window.localStorage.getItem("playbackRate")) || 1);
  const [sleepMinutes, setSleepMinutes] = useState<number | null>(null);
  // Mirror of the session start position in state, so the timeline can draw the
  // "you started here" marker. A ref alone would not re-render.
  const [sessionStart, setSessionStart] = useState<number | null>(null);

  const positionRef = useRef(0);
  const pendingRef = useRef<number | null>(null);
  const pendingDeadlineRef = useRef(0);
  const playIntentRef = useRef(false);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  // Set once the listener does something of their own (play, seek, chapter
  // pick) so a late-arriving restore cannot override it.
  const userInteractedRef = useRef(false);
  /**
   * The media currently on the element.
   *
   * `key` is the resolved URL identity (downloaded file vs stream); `sourceKey`
   * is which media that is. Both are needed: a seek inside the same media is a
   * `currentTime` write, a seek into different media is a reload.
   */
  const loadedRef = useRef<{ key: string; sourceKey: string; base: number; index: number } | null>(null);
  // Set when a failure means the element must be reloaded even though the
  // resolved identity has not changed (a renewed media token).
  const forceReloadRef = useRef(false);
  const tokenRetriedRef = useRef(false);
  // Absolute book position at which "end of chapter" should stop playback.
  // A boundary, not an index, so it can be recomputed when the listener seeks.
  const stopAtRef = useRef<number | null>(null);
  const sleepTimerRef = useRef<number | null>(null);
  const sessionRef = useRef<{ fromPosition: number; startedAt: string } | null>(null);

  const displayPosition = pending ?? position;
  const plan = planPosition(book, segments, kind, displayPosition);
  const described = useMemo(
    () => describePosition(segments, displayPosition, kind, total),
    [segments, displayPosition, kind, total],
  );

  /**
   * Where the listener is, including a seek that has not landed yet.
   *
   * Everything that records or displays a position uses this, so a save during
   * a track swap stores where they asked to be, not where the outgoing track
   * happened to be.
   */
  function bookPosition(): number {
    return pendingRef.current ?? positionRef.current;
  }

  const sourceState = usePlayerSource({
    bookId: book.id,
    source: plan.source,
    localUrlForTrack,
  });
  const resolved = sourceState.resolved;
  const resolvedRef = useRef(resolved);
  resolvedRef.current = resolved;

  /* ------------------------------------------------------------- saving */

  const saveProgress = (at: number, onSettled?: () => void, completed = false) => {
    // `onSettled` lets the shell refetch the library once the *final* save has
    // actually landed, rather than on a guessed delay that races this request.
    //
    // The encrypted copy is written whether or not the request lands: offline
    // listening is the point, and a failed write must not lose the position.
    const progress = { position: at, completed, lastPlayed: new Date().toISOString() };
    void fetch(`/api/audiobooks/${book.id}/progress`, {
      method: "PUT",
      keepalive: true,
      headers: { "Content-Type": "application/json", ...profileHeaders() },
      body: JSON.stringify({ position: at, ...(completed ? { completed: true } : {}) }),
    })
      .catch(() => undefined)
      .then(() => cacheProgress(book.id, progress))
      .catch(() => undefined)
      .then(() => onSettled?.());
  };

  const openSession = (fromPosition: number) => {
    if (sessionRef.current) return;
    sessionRef.current = { fromPosition, startedAt: new Date().toISOString() };
    setSessionStart(fromPosition);
  };

  const flushSession = (toPosition: number) => {
    const session = sessionRef.current;
    sessionRef.current = null;
    setSessionStart(null);
    if (!session) return;
    // keepalive: the browser cancels in-flight requests on navigation, and this
    // flush is exactly the case where the user closes the tab or the app is
    // backgrounded.
    void fetch(`/api/audiobooks/${book.id}/sessions`, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json", ...profileHeaders() },
      body: JSON.stringify({
        fromPosition: session.fromPosition,
        toPosition,
        speed: speedRef.current,
        startedAt: session.startedAt,
        endedAt: new Date().toISOString(),
      }),
    }).catch(() => undefined);
  };

  /* ---------------------------------------------------------- transport */

  function setIntent(next: boolean) {
    playIntentRef.current = next;
    setPlayIntent(next);
  }

  /**
   * `play()` was refused. Which refusal matters:
   *
   * - **`NotAllowedError`** is the browser's autoplay policy. It happens when
   *   the listener pressed Play before the source had been resolved, so
   *   playback actually started from the load effect, outside the gesture.
   *   Nothing is broken: the source exists now, so tapping Play again plays.
   *   Reporting "Playback could not start" here turned a one-second race into
   *   what looked like a dead player.
   * - **Everything else** (`NotSupportedError`, a decode failure, a cancelled
   *   request) is a real failure and is reported.
   *
   * Either way the intent is dropped, so the button returns to Play rather
   * than claiming to be playing something that is silent.
   */
  function reportPlayFailure(reason?: unknown) {
    setIntent(false);
    setPlaying(false);
    if ((reason as { name?: string } | undefined)?.name === "NotAllowedError") return;
    setError(copy.player.playbackCouldNotStart);
  }

  function play() {
    const audio = audioRef.current;
    if (!audio) return;
    void audio.play().catch(reportPlayFailure);
  }

  /**
   * The only transport primitive. Every seek, chapter jump, skip, advance and
   * resume goes through here.
   *
   * A position inside the media that is already loaded is a seek. A position in
   * different media is a request: it is recorded as `pending`, and the load
   * effect applies it to the new file once that file has metadata. Nothing has
   * to survive a URL change by hand.
   */
  function goTo(target: number, options: { play?: boolean } = {}) {
    const next = clamp(target, 0, total || Number.MAX_SAFE_INTEGER);
    const targetPlan = planPosition(book, segments, kind, next);

    pendingRef.current = next;
    setPending(next);
    positionRef.current = next;
    setPosition(next);

    if (options.play !== undefined) setIntent(options.play);
    if (stopAtRef.current !== null) stopAtRef.current = segmentEnd(targetPlan.segment);

    const audio = audioRef.current;
    const loaded = loadedRef.current;
    // "Same media" means the element (or the source already resolved for it)
    // is the file this position belongs to. Then the seek is a `currentTime`
    // write. Otherwise the load effect loads the new media and applies the
    // same position to it.
    const sameMedia = audio !== null && (loaded
      ? loaded.sourceKey === targetPlan.source.key
      : resolvedRef.current?.sourceKey === targetPlan.source.key);

    // The clock only starts when the seek is actually issued. A position that
    // is waiting for a different file to load must not time out before the file
    // has even been asked for -- that is how a seek gets lost.
    pendingDeadlineRef.current = sameMedia ? Date.now() + PENDING_TIMEOUT_MS : 0;

    if (audio && sameMedia) {
      // Same file: jump straight there. This is the chapter book's whole
      // advance mechanism, and the reason it is seamless.
      if (audio.readyState >= 1) audio.currentTime = targetPlan.sourceTime;
      if (options.play) play();
    }
    // Otherwise the load effect below loads the new media and applies the same
    // position. `playIntent` tells it whether to start on arrival.
  }

  function togglePlayback(force?: boolean) {
    if (!activeProfileId) return;
    userInteractedRef.current = true;
    const next = force ?? !playIntentRef.current;
    setIntent(next);
    const audio = audioRef.current;
    if (!audio) return;
    if (!next) {
      audio.pause();
      return;
    }
    // The source may still be resolving. Setting the intent is enough: the load
    // effect starts playback when the URL arrives. Calling play() on an element
    // with no source is what produced "Playback could not start".
    if (audio.src || audio.currentSrc) play();
  }

  function skipSeconds(delta: number) {
    userInteractedRef.current = true;
    goTo(bookPosition() + delta);
  }

  function skipSegment(delta: number) {
    userInteractedRef.current = true;
    const index = locateSegment(segments, bookPosition()).index;
    const target = delta < 0
      ? previousSegmentIndex(segments, index)
      : nextSegmentIndex(segments, index);
    if (target === null) return;
    goTo(segments[target].offset, { play: true });
  }

  function selectSegment(index: number) {
    userInteractedRef.current = true;
    const target = planSegment(book, segments, kind, index);
    goTo(target.position, { play: true });
  }

  function changeSpeed(next: number) {
    setSpeed(next);
    window.localStorage.setItem("playbackRate", String(next));
    if (audioRef.current) audioRef.current.playbackRate = next;
  }

  function setSleepTimer(minutes: number | null) {
    if (sleepTimerRef.current !== null) {
      window.clearTimeout(sleepTimerRef.current);
      sleepTimerRef.current = null;
    }
    stopAtRef.current = null;
    setSleepMinutes(minutes);
    if (minutes === null) return;
    if (minutes === -1) {
      // "End of chapter" is the end of the chapter they are in *now*, so it is
      // recomputed on every seek -- going back a chapter arms the new one.
      const current = planPosition(book, segments, kind, bookPosition());
      stopAtRef.current = segmentEnd(current.segment);
      return;
    }
    sleepTimerRef.current = window.setTimeout(() => {
      setIntent(false);
      audioRef.current?.pause();
      setSleepMinutes(null);
    }, minutes * 60_000);
  }

  /* ------------------------------------------------------------- effects */

  // Restore the saved resume position once per book.
  useEffect(() => {
    let cancelled = false;
    const applyResume = (saved: number) => {
      if (cancelled || !saved || saved <= 0) return;
      // The listener may have started playing or picked a chapter while this
      // request was in flight. Their choice wins.
      if (userInteractedRef.current) return;
      goTo(saved);
    };

    void (async () => {
      let saved = 0;
      try {
        const res = await fetch(`/api/audiobooks/${book.id}/progress`, { headers: profileHeaders() });
        if (res.ok) {
          const body = (await res.json()) as { position?: number };
          saved = body.position ?? 0;
        } else {
          // Offline or unauthorised: the encrypted row is the last position this
          // profile saw. It only exists while the profile key is unlocked.
          saved = (await readProgress(book.id))?.position ?? 0;
        }
      } catch {
        saved = (await readProgress(book.id))?.position ?? 0;
      }
      applyResume(saved);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);

  // Periodic progress save while playing (spec 04: report every ~10s).
  useEffect(() => {
    if (!playing) return;
    openSession(bookPosition());
    const timer = window.setInterval(() => saveProgress(bookPosition()), 10_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  // Flush progress + session when the listener stops, or the page goes away.
  useEffect(() => {
    const audio = audioRef.current;

    /**
     * A `pause` we caused ourselves must not be saved as the listener stopping:
     * swapping the source emits a synthetic pause, and the render closure's
     * position at that moment is meaningless. `playIntent` is the signal --
     * a real stop clears it before the element is paused.
     */
    const onPauseAndSave = () => {
      if (!sessionRef.current || playIntentRef.current) return;
      const at = bookPosition();
      saveProgress(at);
      flushSession(at);
    };

    /** A flush always saves: backgrounding the app keeps the intent to play. */
    const onHidden = () => {
      if (!sessionRef.current) return;
      const at = bookPosition();
      saveProgress(at);
      flushSession(at);
    };

    audio?.addEventListener("pause", onPauseAndSave);
    window.addEventListener("pagehide", onHidden);
    // Mobile browsers do not reliably fire pagehide when an app is backgrounded,
    // and the page may then be frozen or discarded, so flush on hide too.
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") onHidden();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      audio?.removeEventListener("pause", onPauseAndSave);
      window.removeEventListener("pagehide", onHidden);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Element events, registered exactly once.
  //
  // Registering them per-render (as this used to) meant every handler captured
  // whatever index and position that render saw, so a handler could act on a
  // track the player had already left. Refs do not go stale.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => {
      const loaded = loadedRef.current;
      if (!loaded) return;
      const at = bookPositionFromSource(loaded.base, audio.currentTime);

      const target = pendingRef.current;
      if (target !== null) {
        const arrived = Math.abs(at - target) <= 1.5;
        // A seek is in flight and the element is still reporting its old
        // position. Do not let that drag the readout backwards. A deadline of
        // 0 means the seek has not been issued yet (the file is still being
        // fetched), so there is nothing to time out. Once it has been issued,
        // the deadline stops a seek the browser ignored from freezing the
        // display forever.
        if (!arrived && (pendingDeadlineRef.current === 0 || Date.now() < pendingDeadlineRef.current)) return;
        pendingRef.current = null;
        setPending(null);
      }

      positionRef.current = at;
      setPosition(at);

      // "End of chapter" is detected here, from the position, because a chapter
      // book plays straight through a boundary inside one file and never fires
      // `ended`. This is the only place that can stop it.
      const stopAt = stopAtRef.current;
      if (stopAt !== null && at >= stopAt - 0.05) {
        stopAtRef.current = null;
        setSleepMinutes(null);
        setIntent(false);
        audio.pause();
      }
    };

    const onPlay = () => {
      setPlaying(true);
      setError("");
      tokenRetriedRef.current = false;
      actionsRef.current?.openSession(bookPosition());
    };

    const onPause = () => setPlaying(false);

    const onLoadedMetadata = () => {
      const target = pendingRef.current;
      if (target === null) return;
      const base = loadedRef.current?.base ?? 0;
      const time = Math.max(0, target - base);
      if (Math.abs(audio.currentTime - time) > 0.5) audio.currentTime = time;
    };

    const onEnded = () => {
      const loaded = loadedRef.current;

      // A per-track source ending means "this file is done". A whole-book
      // source ending means the *book* is done: a chapter book has no per-
      // chapter `ended`, so treating it as "advance" would be dead code that
      // only ever ran in tests.
      //
      // Which segment this was has to come from the *loaded source*, not from
      // the element's clock: at the end of track 1 the clock reads track 1's
      // duration, which is the book position where track 2 starts. Advancing
      // from that would skip track 2.
      const next = kind === "tracks" && loaded ? nextSegmentIndex(segments, loaded.index) : null;
      if (next !== null) {
        actionsRef.current?.goTo(segments[next].offset, { play: true });
        return;
      }

      pendingRef.current = null;
      setPending(null);
      positionRef.current = total;
      setPosition(total);
      setIntent(false);
      setPlaying(false);
      actionsRef.current?.saveProgress(total, () => onProgressSavedRef.current?.(), true);
      actionsRef.current?.flushSession(total);
    };

    const onError = () => {
      if (!resolvedRef.current) return;
      // 1 is MEDIA_ERR_ABORTED: us replacing the source, not a real failure.
      if (audio.error?.code === 1) return;
      setPlaying(false);

      // Escalate rather than give up: the downloaded file may have been removed
      // by the OS, and a media token may have expired. Each step has a real
      // alternative, and only when they are all exhausted is it an error.
      if (resolvedRef.current.local) {
        sourceState.markLocalFailed();
        return;
      }
      if (!tokenRetriedRef.current) {
        tokenRetriedRef.current = true;
        forceReloadRef.current = true;
        sourceState.retry();
        return;
      }
      setIntent(false);
      setError(copy.player.audioLoadFailed);
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, kind, total]);

  /**
   * Load the media the current position needs.
   *
   * Guarded by the resolved identity so a re-render, a token refresh or a
   * device-library refresh cannot reload a playing file and throw away its
   * place. `forceReloadRef` is the escape hatch for a deliberate retry.
   */
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !resolved) return;
    const loaded = loadedRef.current;
    if (loaded && loaded.key === resolved.key && !forceReloadRef.current) return;
    forceReloadRef.current = false;

    const target = pendingRef.current ?? positionRef.current;
    const targetPlan = planPosition(book, segments, kind, target);

    loadedRef.current = {
      key: resolved.key,
      sourceKey: targetPlan.source.key,
      base: targetPlan.base,
      index: targetPlan.index,
    };
    tokenRetriedRef.current = false;
    setError("");

    audio.src = resolved.url;
    audio.load();
    // The seek is only now worth timing: a browser that ignores it must not
    // hold the readout on a position it never reached.
    pendingDeadlineRef.current = pendingRef.current === null ? 0 : Date.now() + PENDING_TIMEOUT_MS;
    // `load()` resets the playhead. Apply the position immediately when the
    // element already has metadata; otherwise `loadedmetadata` does it.
    if (audio.readyState >= 1) audio.currentTime = targetPlan.sourceTime;
    if (playIntentRef.current) {
      void audio.play().catch(reportPlayFailure);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved?.key, resolved?.url, sourceState.attempt, book, segments, kind]);

  // Apply playback speed, including to a newly loaded file.
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed, resolved?.key]);

  /**
   * Save on unmount, and only when there is something worth saving.
   *
   * Merely opening a book mounts this at position 0, and React StrictMode
   * unmounts and remounts once in development -- which used to wipe the stored
   * position before the restore could read it, so resume never happened.
   */
  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      if (!audio) return;
      const at = pendingRef.current ?? (bookPositionFromSource(loadedRef.current?.base ?? 0, audio.currentTime));
      const restoreInFlight = pendingRef.current !== null && !sessionRef.current;
      if (!restoreInFlight && (sessionRef.current || at > 0)) {
        saveProgress(at, () => onProgressSavedRef.current?.());
        flushSession(at);
      }
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lock-screen / notification controls.
  //
  // Registered through the shared helper rather than inline against
  // `navigator.mediaSession`, because on Android the web handlers alone left the
  // platform MediaSession with `actions=0` -- the lock screen drew the scrubber
  // and no buttons at all. See mediaSession.ts.
  useEffect(() => {
    return registerMediaSessionHandlers({
      play: () => actionsRef.current?.togglePlayback(true),
      pause: () => actionsRef.current?.togglePlayback(false),
      seekBackward: () => actionsRef.current?.skipSeconds(-SKIP_SECONDS),
      seekForward: () => actionsRef.current?.skipSeconds(SKIP_SECONDS),
      // Chapter navigation, which is what prev/next mean in an audiobook.
      previousTrack: () => actionsRef.current?.skipSegment(-1),
      nextTrack: () => actionsRef.current?.skipSegment(1),
    });
  }, []);

  // The lock screen names the chapter, so update it when the chapter changes.
  useEffect(() => {
    setMediaMetadata(described.title || book.title, book.author, book.title);
  }, [described.title, book.title, book.author]);

  // Keep the platform session's playback state in step with the audio element.
  // Driven off the element's own events because the platform gates the
  // play/pause buttons on this value -- a stale value means no buttons.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const publish = () => publishPlaybackState(audio.paused ? "paused" : "playing");
    const ended = () => publishPlaybackState("none");
    publish();
    audio.addEventListener("play", publish);
    audio.addEventListener("pause", publish);
    audio.addEventListener("ended", ended);
    return () => {
      audio.removeEventListener("play", publish);
      audio.removeEventListener("pause", publish);
      audio.removeEventListener("ended", ended);
    };
  }, []);

  // Feed the position to the platform session so the lock-screen scrubber
  // tracks playback instead of sitting at zero.
  useEffect(
    () =>
      publishPosition(() => {
        const audio = audioRef.current;
        return {
          position: Math.round(audio?.currentTime ?? 0),
          duration: Math.round(audio?.duration ?? 0),
          rate: audio && !audio.paused ? audio.playbackRate : 0,
        };
      }),
    [],
  );

  actionsRef.current = {
    goTo,
    togglePlayback,
    skipSeconds,
    skipSegment,
    saveProgress,
    flushSession,
    openSession,
  };

  const currentIndex = described.segmentIndex;
  const showsPause = playing || playIntent;

  return (
    /* The console. Raspberry-tinted because this is the machine doing one thing
       at a time, and the one surface where the eye should land first. */
    <section
      className="panel mt-8 p-4 sm:p-5"
      aria-label={copy.player.region}
      style={{ background: "color-mix(in srgb, var(--rasp) 7%, var(--surface))" }}
    >
      <audio ref={audioRef} preload="metadata" />

      {/* `flex-wrap` so the transport controls wrap onto a second row on a phone.
          A non-wrapping flex cannot shrink below the sum of its items'
          min-content widths, so four buttons plus two selects forced this row
          to 529px inside a 318px panel -- which overflowed the dialog and made
          the whole player look zoomed in. `min-w-0` on the title block below
          lets the text truncate rather than push the row wider. */}
      <div className="flex flex-wrap items-center gap-3">
        <Dome
          label={showsPause ? copy.player.pause : copy.player.play}
          onClick={() => togglePlayback()}
          spin={playing}
          disabled={!activeProfileId}
        >
          {showsPause ? (
            <Pause size={22} className="fill-white text-white" aria-hidden="true" />
          ) : (
            <Play size={22} className="translate-x-[1px] fill-white text-white" aria-hidden="true" />
          )}
        </Dome>

        <div className="flex items-center gap-2">
          <Btn
            variant="quiet"
            onClick={() => skipSegment(-1)}
            aria-label={copy.player.previousChapter}
            disabled={currentIndex <= 0}
            className="iconbtn"
          >
            <SkipBack size={17} aria-hidden="true" />
          </Btn>
          <Btn
            variant="quiet"
            onClick={() => skipSegment(1)}
            aria-label={copy.player.nextChapter}
            disabled={currentIndex >= segments.length - 1}
            className="iconbtn"
          >
            <SkipForward size={17} aria-hidden="true" />
          </Btn>
          <Btn
            variant="quiet"
            size="sm"
            onClick={() => skipSeconds(-SKIP_SECONDS)}
            aria-label={copy.player.backSeconds(SKIP_SECONDS)}
            className="tnum"
          >
            −{SKIP_SECONDS}s
          </Btn>
          <Btn
            variant="quiet"
            size="sm"
            onClick={() => skipSeconds(SKIP_SECONDS)}
            aria-label={copy.player.forwardSeconds(SKIP_SECONDS)}
            className="tnum"
          >
            +{SKIP_SECONDS}s
          </Btn>
        </div>

        <select
          aria-label={copy.player.speed}
          value={speed}
          onChange={(event) => changeSpeed(Number(event.target.value))}
          className="rounded-[14px_11px_14px_11px/11px_14px_11px_14px] border-2 border-ink/30 bg-surface px-2.5 py-1.5 text-[13px] font-bold text-ink"
        >
          {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3].map((rate) => <option key={rate} value={rate}>{rate}x</option>)}
        </select>
        <select
          aria-label={copy.player.sleepTimer}
          value={sleepMinutes ?? "off"}
          onChange={(event) => setSleepTimer(event.target.value === "off" ? null : Number(event.target.value))}
          className="rounded-[14px_11px_14px_11px/11px_14px_11px_14px] border-2 border-ink/30 bg-surface px-2.5 py-1.5 text-[13px] font-bold text-ink"
        >
          <option value="off">{copy.player.sleepOff}</option>
          <option value="15">{copy.player.sleepMinutes(15)}</option>
          <option value="30">{copy.player.sleepMinutes(30)}</option>
          <option value="60">{copy.player.sleepMinutes(60)}</option>
          <option value="-1">{copy.player.sleepEndOfChapter}</option>
        </select>

        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[15px] font-semibold text-ink">
            {described.title || copy.player.trackFallback(currentIndex + 1)}
          </p>
          <p className="text-[12px] text-ink3 tnum">
            {segments.length > 1 ? `${described.heading} of ${segments.length}` : described.heading}
          </p>
        </div>
      </div>

      {!activeProfileId && (
        <p role="alert" className="panel panel--flat mt-3 px-3 py-2 text-[13px] font-bold text-tan-ink">
          {copy.player.needsProfile}
        </p>
      )}

      {/* Spec 14. Not an aria-live region on purpose: this text changes several
          times a second and announcing each change would make the player
          unusable with a screen reader (decisions/007). */}
      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1" data-testid="position-readout">
        <p className="min-w-0 font-display text-[16px] font-semibold text-ink">
          {described.heading}
          {described.title && <span className="font-normal text-ink2"> — {described.title}</span>}
        </p>
        <p className="text-[12.5px] text-ink3 tnum" data-testid="chapter-readout">
          {timeLabel(described.segmentElapsed)} {copy.player.intoThis(kind === "tracks" ? "track" : "chapter")} · {Math.round(described.segmentPercent)}%
        </p>
        <p className="text-[12.5px] text-ink3 tnum" data-testid="book-readout">
          {Math.round(described.bookPercent)}% of the book · {remainingLabel(described.bookRemaining)}
        </p>
      </div>

      <div className="mt-2.5">
        <ProgressTimeline
          segments={segments}
          kind={kind}
          total={total}
          value={described.bookPosition}
          sessionStart={sessionStart}
          segmentElapsed={described.segmentElapsed}
          segmentDuration={described.segmentDuration}
          segmentHeading={described.heading}
          onSeek={(target) => {
            userInteractedRef.current = true;
            // Keep whatever the listener was doing: dragging the scrubber while
            // paused must not start playback, and dragging while playing must
            // not stop it.
            goTo(target, { play: playIntentRef.current });
          }}
        />
      </div>

      {error && (
        <p role="alert" className="panel panel--flat mt-3 px-3 py-2 text-[13px] font-bold text-rasp-ink">{error}</p>
      )}

      {segments.length > 1 && (
        <ol className="panel panel--sunk mt-4 max-h-52 divide-y divide-ink/10 overflow-auto">
          {segments.map((segment, index) => (
            <li key={segment.key}>
              <button
                type="button"
                onClick={() => selectSegment(index)}
                aria-current={index === currentIndex ? "true" : undefined}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-[13.5px] font-semibold transition ${
                  index === currentIndex ? "bg-rasp text-white" : "text-ink2 hover:bg-ink/5"
                }`}
              >
                <span className="min-w-0 truncate">
                  <span className={`mr-2 tnum ${index === currentIndex ? "text-white/70" : "text-ink3"}`}>{index + 1}.</span>
                  {segment.title || copy.player.trackFallback(index + 1)}
                </span>
                <span className="shrink-0 text-[11.5px] tnum opacity-80">
                  {index === currentIndex ? `${timeLabel(described.segmentElapsed)} / ` : ""}
                  {timeLabel(segment.duration)}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
