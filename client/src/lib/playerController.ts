import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { Audiobook } from "../types";
import { apiFetch, getActiveProfileId } from "./api";
import { cacheProgress, readProgress } from "../local/privateCache";
import { copy } from "../copy";
import {
  publishPlaybackState,
  publishPosition,
  registerMediaSessionHandlers,
  setMediaMetadata,
} from "../components/mediaSession";
import {
  clamp,
  describePosition,
  locateSegment,
  parseSegments,
  totalDuration as computeTotalDuration,
  type PositionDescription,
  type Segment,
  type SegmentKind,
} from "./position";
import {
  bookPositionFromSource,
  nextSegmentIndex,
  planPosition,
  planSegment,
  previousSegmentIndex,
  segmentEnd,
  type SourcePlan,
} from "./playback";
import { usePlayerSource, type PlayerSource } from "./usePlayerSource";

/** Seconds moved by the in-app and lock-screen skip buttons, together. */
export const SKIP_SECONDS = 15;

/**
 * How long a requested position may stay "pending" before the element's own
 * position wins. Long enough for a slow track swap on a phone, short enough
 * that a seek the browser silently ignored does not freeze the readout.
 */
export const PENDING_TIMEOUT_MS = 5000;

export type PlayerActions = {
  goTo: (target: number, options?: { play?: boolean }) => void;
  togglePlayback: (force?: boolean) => void;
  skipSeconds: (delta: number) => void;
  skipSegment: (delta: number) => void;
  selectSegment: (index: number) => void;
  changeSpeed: (next: number) => void;
  setSleepTimer: (minutes: number | null) => void;
  saveProgress: (position: number, onSettled?: () => void, completed?: boolean) => void;
  flushSession: (toPosition: number) => void;
  openSession: (fromPosition: number) => void;
};

export type PlayerControllerOptions = {
  book: Audiobook;
  onProgressSaved?: () => void;
  localUrlForTrack?: (bookId: number, trackId: number, serverId?: string) => Promise<string | undefined>;
  profileId?: string | number | null;
  audioRef?: RefObject<HTMLAudioElement | null>;
};

export type PlayerController = {
  audioRef: RefObject<HTMLAudioElement | null>;
  position: number;
  pending: number | null;
  displayPosition: number;
  playing: boolean;
  playIntent: boolean;
  activeProfileId: string | null;
  speed: number;
  sleepMinutes: number | null;
  sessionStart: number | null;
  error: string;
  segments: Segment[];
  kind: SegmentKind;
  total: number;
  plan: SourcePlan;
  described: PositionDescription;
  resolvedSource: PlayerSource | null;
  goTo: (target: number, options?: { play?: boolean }) => void;
  togglePlayback: (force?: boolean) => void;
  skipSeconds: (delta: number) => void;
  skipSegment: (delta: number) => void;
  selectSegment: (index: number) => void;
  changeSpeed: (next: number) => void;
  setSleepTimer: (minutes: number | null) => void;
  saveProgress: (position: number, onSettled?: () => void, completed?: boolean) => void;
  openSession: (fromPosition: number) => void;
  flushSession: (toPosition: number) => void;
};

/**
 * Player controller module.
 *
 * Owns position state, transport actions, persistence and DOM audio synchronization
 * according to ADR 017:
 * "The player's state is the listening position, not the media source. Everything
 * else -- which file is loaded, where in that file the playhead goes, whether
 * the element should be playing -- is derived from the position."
 */
export function usePlayerController({
  book,
  onProgressSaved,
  localUrlForTrack,
  profileId,
  audioRef: externalAudioRef,
}: PlayerControllerOptions): PlayerController {
  const internalAudioRef = useRef<HTMLAudioElement>(null);
  const audioRef = externalAudioRef ?? internalAudioRef;

  const actionsRef = useRef<PlayerActions | null>(null);
  const onProgressSavedRef = useRef(onProgressSaved);
  onProgressSavedRef.current = onProgressSaved;

  const activeProfileId = profileId === undefined
    ? getActiveProfileId()
    : profileId === null
      ? null
      : String(profileId);

  const { segments, kind } = useMemo(() => parseSegments(book), [book]);
  const total = useMemo(() => computeTotalDuration(book, segments), [book, segments]);

  const [position, setPosition] = useState(0);
  const [pending, setPending] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playIntent, setPlayIntent] = useState(false);
  const [error, setError] = useState("");
  const [speed, setSpeed] = useState<number>(() => Number(window.localStorage.getItem("playbackRate")) || 1);
  const [sleepMinutes, setSleepMinutesState] = useState<number | null>(null);
  const [sessionStart, setSessionStart] = useState<number | null>(null);

  const positionRef = useRef(0);
  const pendingRef = useRef<number | null>(null);
  const pendingDeadlineRef = useRef(0);
  const playIntentRef = useRef(false);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const userInteractedRef = useRef(false);

  const loadedRef = useRef<{ key: string; sourceKey: string; base: number; index: number } | null>(null);
  const forceReloadRef = useRef(false);
  const tokenRetriedRef = useRef(false);
  const stopAtRef = useRef<number | null>(null);
  const sleepTimerRef = useRef<number | null>(null);
  const sessionRef = useRef<{ fromPosition: number; startedAt: string } | null>(null);

  const displayPosition = pending ?? position;
  const plan = planPosition(book, segments, kind, displayPosition);
  const described = useMemo(
    () => describePosition(segments, displayPosition, kind, total),
    [segments, displayPosition, kind, total],
  );

  function bookPosition(): number {
    return pendingRef.current ?? positionRef.current;
  }

  const sourceState = usePlayerSource({
    bookId: book.id,
    source: plan.source,
    localUrlForTrack,
    serverId: book.serverId,
  });
  const resolved = sourceState.resolved;
  const resolvedRef = useRef(resolved);
  resolvedRef.current = resolved;

  /* ------------------------------------------------------------- saving */

  const saveProgress = useCallback((at: number, onSettled?: () => void, completed = false) => {
    const progress = { position: at, completed, lastPlayed: new Date().toISOString() };
    void apiFetch(`/api/audiobooks/${book.id}/progress`, {
      method: "PUT",
      keepalive: true,
      body: JSON.stringify({ position: at, ...(completed ? { completed: true } : {}) }),
    })
      .catch(() => undefined)
      .then(() => cacheProgress(book.id, progress))
      .catch(() => undefined)
      .then(() => onSettled?.());
  }, [book.id]);

  const openSession = useCallback((fromPosition: number) => {
    if (sessionRef.current) return;
    sessionRef.current = { fromPosition, startedAt: new Date().toISOString() };
    setSessionStart(fromPosition);
  }, []);

  const flushSession = useCallback((toPosition: number) => {
    const session = sessionRef.current;
    sessionRef.current = null;
    setSessionStart(null);
    if (!session) return;

    void apiFetch(`/api/audiobooks/${book.id}/sessions`, {
      method: "POST",
      keepalive: true,
      body: JSON.stringify({
        fromPosition: session.fromPosition,
        toPosition,
        speed: speedRef.current,
        startedAt: session.startedAt,
        endedAt: new Date().toISOString(),
      }),
    }).catch(() => undefined);
  }, [book.id]);

  /* ---------------------------------------------------------- transport */

  function setIntent(next: boolean) {
    playIntentRef.current = next;
    setPlayIntent(next);
  }

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

  function goTo(target: number, options: { play?: boolean; user?: boolean } = {}) {
    if (options.user !== false) {
      userInteractedRef.current = true;
    }
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
    const sameMedia = audio !== null && (loaded
      ? loaded.sourceKey === targetPlan.source.key
      : resolvedRef.current?.sourceKey === targetPlan.source.key);

    pendingDeadlineRef.current = sameMedia ? Date.now() + PENDING_TIMEOUT_MS : 0;

    if (audio && sameMedia) {
      if (audio.readyState >= 1) audio.currentTime = targetPlan.sourceTime;
      if (options.play) play();
    }
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
    setSleepMinutesState(minutes);
    if (minutes === null) return;
    if (minutes === -1) {
      const current = planPosition(book, segments, kind, bookPosition());
      stopAtRef.current = segmentEnd(current.segment);
      return;
    }
    sleepTimerRef.current = window.setTimeout(() => {
      setIntent(false);
      audioRef.current?.pause();
      setSleepMinutesState(null);
    }, minutes * 60_000);
  }

  /* ------------------------------------------------------------- effects */

  // Restore the saved resume position once per book.
  useEffect(() => {
    let cancelled = false;
    const applyResume = (saved: number) => {
      if (cancelled || !saved || saved <= 0) return;
      if (userInteractedRef.current) return;
      goTo(saved, { user: false });
    };

    void (async () => {
      let saved = 0;
      try {
        const progress = await apiFetch<{ position?: number }>(`/api/audiobooks/${book.id}/progress`);
        saved = progress.position ?? 0;
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

    const onPauseAndSave = () => {
      if (!sessionRef.current || playIntentRef.current) return;
      const at = bookPosition();
      saveProgress(at);
      flushSession(at);
    };

    const onHidden = () => {
      if (!sessionRef.current) return;
      const at = bookPosition();
      saveProgress(at);
      flushSession(at);
    };

    audio?.addEventListener("pause", onPauseAndSave);
    window.addEventListener("pagehide", onHidden);
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
        if (!arrived && (pendingDeadlineRef.current === 0 || Date.now() < pendingDeadlineRef.current)) return;
        pendingRef.current = null;
        setPending(null);
      }

      positionRef.current = at;
      setPosition(at);

      const stopAt = stopAtRef.current;
      if (stopAt !== null && at >= stopAt - 0.05) {
        stopAtRef.current = null;
        setSleepMinutesState(null);
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
      const target = pendingRef.current ?? positionRef.current;
      const base = loadedRef.current?.base ?? 0;
      const time = Math.max(0, target - base);
      if (Math.abs(audio.currentTime - time) > 0.5) audio.currentTime = time;
    };

    const onEnded = () => {
      const loaded = loadedRef.current;
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
      if (audio.error?.code === 1) return;
      setPlaying(false);

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
    pendingDeadlineRef.current = pendingRef.current === null ? 0 : Date.now() + PENDING_TIMEOUT_MS;
    if (audio.readyState >= 1) audio.currentTime = targetPlan.sourceTime;
    if (playIntentRef.current) {
      void audio.play().catch(reportPlayFailure);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved?.key, resolved?.url, sourceState.attempt, book, segments, kind]);

  // Apply playback speed, including to a newly loaded file.
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed, resolved?.key, audioRef]);

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
      const targetAudio = audio ?? audioRef.current;
      const at = pendingRef.current ?? (bookPositionFromSource(loadedRef.current?.base ?? 0, targetAudio?.currentTime ?? 0));
      const restoreInFlight = pendingRef.current !== null && !sessionRef.current && !userInteractedRef.current;
      if (!restoreInFlight && (sessionRef.current || at > 0)) {
        saveProgress(at, () => onProgressSavedRef.current?.());
        flushSession(at);
      }
      if (targetAudio) {
        targetAudio.pause();
        targetAudio.removeAttribute("src");
        targetAudio.load();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lock-screen / notification controls.
  useEffect(() => {
    return registerMediaSessionHandlers({
      play: () => {
        publishPlaybackState("playing");
        actionsRef.current?.togglePlayback(true);
      },
      pause: () => {
        publishPlaybackState("paused");
        actionsRef.current?.togglePlayback(false);
      },
      seekBackward: () => actionsRef.current?.skipSeconds(-SKIP_SECONDS),
      seekForward: () => actionsRef.current?.skipSeconds(SKIP_SECONDS),
      seekTo: (details) => {
        if (typeof details?.seekTime === "number" && Number.isFinite(details.seekTime)) {
          const base = loadedRef.current?.base ?? 0;
          actionsRef.current?.goTo(base + details.seekTime);
        }
      },
      previousTrack: () => actionsRef.current?.skipSegment(-1),
      nextTrack: () => actionsRef.current?.skipSegment(1),
    });
  }, []);

  // Update lock screen chapter metadata.
  useEffect(() => {
    setMediaMetadata(described.title || book.title, book.author, book.title);
  }, [described.title, book.title, book.author]);

  // Keep platform session's playback state in step with the audio element.
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
  }, [audioRef]);

  // Feed position to platform session for lock-screen scrubber.
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
    [audioRef],
  );

  actionsRef.current = {
    goTo,
    togglePlayback,
    skipSeconds,
    skipSegment,
    selectSegment,
    changeSpeed,
    setSleepTimer,
    saveProgress,
    flushSession,
    openSession,
  };

  return {
    audioRef,
    position,
    pending,
    displayPosition,
    playing,
    playIntent,
    activeProfileId,
    speed,
    sleepMinutes,
    sessionStart,
    error,
    segments,
    kind,
    total,
    plan,
    described,
    resolvedSource: resolved,
    goTo,
    togglePlayback,
    skipSeconds,
    skipSegment,
    selectSegment,
    changeSpeed,
    setSleepTimer,
    saveProgress,
    openSession,
    flushSession,
  };
}
