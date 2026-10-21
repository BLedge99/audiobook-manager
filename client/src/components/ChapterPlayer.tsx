import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import type { Audiobook, Track } from "../types";
import { apiUrl, withSessionToken } from "../lib/api";
import { copy } from "../copy";
import { ProgressTimeline } from "./ProgressTimeline";
import { Btn, Dome } from "../ui/primitives";
import { publishPlaybackState, publishPosition, registerMediaSessionHandlers, setMediaMetadata } from "./mediaSession";
import {
  describePosition,
  parseChapters,
  parseSegments,
  remainingLabel,
  timeLabel,
  totalDuration as computeTotalDuration,
} from "../lib/position";

/**
 * @param localUrlForTrack Resolve a downloaded track to a playable local URL
 *   (spec 26, Sprint 2). Optional: absent in the PWA and the browser dev app,
 *   which have no device library, and in a chapter book, which is a single file
 *   rather than per-track segments.
 */
export function ChapterPlayer({
  book,
  onProgressSaved,
  localUrlForTrack,
}: {
  book: Audiobook;
  onProgressSaved?: () => void;
  localUrlForTrack?: (bookId: number, trackId: number) => Promise<string | undefined>;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const pendingSeekRef = useRef<number | null>(null);
  // Held in a ref so the unmount effect can keep its `[]` dependency list while
  // still calling the latest callback.
  const onProgressSavedRef = useRef(onProgressSaved);
  onProgressSavedRef.current = onProgressSaved;
  // Set once the listener does something of their own (play, seek, chapter
  // pick) so a late-arriving restore cannot override it.
  const userInteractedRef = useRef(false);
  // True while we are swapping `src` ourselves. Setting a source emits a
  // synthetic `pause`, which must not be mistaken for the user pausing.
  const switchingSourceRef = useRef(false);
  // The stream URL currently set on the element, used to ignore late
  // `loadedmetadata` events belonging to a source we already replaced.
  const activeSrcRef = useRef<string>("");
  // The within-track position the user last asked for. Re-applied if a
  // redundant load() resets currentTime to 0.
  const desiredTimeRef = useRef<number | null>(null);
  // While set, only a `seeked` event may clear desiredTimeRef. A pending
  // cross-track seek must survive the outgoing track's stray timeupdate,
  // which otherwise overwrites the target with a near-zero value.
  const desiredTimeLockedRef = useRef(false);
  const speedRef = useRef(1);
  // Segment maths lives in lib/position so the GUI redesign (spec 15) can
  // restyle this player without reimplementing any of it.
  const { segments, kind: segmentKind } = useMemo(() => parseSegments(book), [book]);
  const tracks = useMemo<Track[]>(() => book.tracks.length
    ? [...book.tracks].sort((a, b) => a.trackNumber - b.trackNumber)
    : [], [book]);
  const chapters = useMemo(() => parseChapters(book), [book]);
  /**
   * A book with embedded chapters is a chapter book, whatever its tracks say.
   *
   * A single-file book (an M4B) has one track -- the file itself -- *and* its
   * chapters, and the chapters are what the listener navigates by. So the test
   * is the chapters, not the absence of tracks.
   */
  const isChapterBook = chapters.length > 0;

  const [currentIndex, setCurrentIndex] = useState(0);
  const currentIndexRef = useRef(currentIndex);
  currentIndexRef.current = currentIndex;
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [shouldPlay, setShouldPlay] = useState(false);
  const [error, setError] = useState("");
  const [speed, setSpeed] = useState<number>(() => Number(window.localStorage.getItem("playbackRate")) || 1);
  // flushSession is registered once per track and must record the rate the
  // listener actually chose, not whichever value was current when it registered.
  speedRef.current = speed;
  // Progress is profile-scoped: without a selected profile the server
  // rejects every save, so playback must not start silently.
  const [profileId] = useState<string | null>(() => window.localStorage.getItem("profileId"));
  const [sleepMinutes, setSleepMinutes] = useState<number | null>(null);
  const sleepTimerRef = useRef<number | null>(null);
  const stopAtChapterEndRef = useRef(false);

  const current = segments[currentIndex];
  const totalDuration = computeTotalDuration(book, segments);
  const overallPosition = (isChapterBook || tracks.length === 0) ? currentTime : segments[currentIndex].offset + currentTime;
  // Everything the position readout needs, derived from the same segments that
  // drive the timeline so the labels and the ticks cannot disagree.
  const described = useMemo(
    () => describePosition(segments, overallPosition, segmentKind, totalDuration),
    [segments, overallPosition, segmentKind, totalDuration],
  );
  // Latest position for the periodic saver, which must not restart its
  // timer on every position tick (that would prevent it ever firing).
  const overallPositionRef = useRef(overallPosition);
  overallPositionRef.current = overallPosition;
  const remoteUrl = isChapterBook
    ? `/api/audiobooks/${book.id}/stream`
    : tracks.length > 0
      ? `/api/tracks/${segments[currentIndex].trackId}/stream`
      : `/api/audiobooks/${book.id}/stream`;

  /**
   * Play the device copy when there is one (spec 26, Sprint 2).
   *
   * Resolving it is asynchronous -- the local path has to be turned into a URL
   * the WebView will load -- so it lives in state and is applied when it
   * arrives. Deliberately falls back to streaming when the file is missing or
   * unreadable, so a partially-removed book still plays while online.
   *
   * `audio.src` is set outside `fetch`, so the API base has to be applied by
   * hand here. `apiUrl` is only applied to the remote URL; the local one is
   * already a `capacitor-file://` URL and prefixing it would break it.
   */
  const [localSrc, setLocalSrc] = useState<string | undefined>();
  useEffect(() => {
    let cancelled = false;
    setLocalSrc(undefined);

    if (!localUrlForTrack || tracks.length === 0) return;
    // For a chapter book the segments are the chapters, which carry no track
    // id -- the whole book is one file, and that file is the book's single
    // track. Resolving it is what makes a downloaded M4B play on a plane
    // instead of streaming a file it already has.
    const trackId = segments[currentIndex]?.trackId ?? (isChapterBook ? tracks[0]?.id : undefined);
    if (trackId === undefined) return;

    void localUrlForTrack(book.id, trackId).then((url) => {
      if (!cancelled) setLocalSrc(url);
    });

    return () => {
      cancelled = true;
    };
  }, [localUrlForTrack, book.id, isChapterBook, tracks, segments, currentIndex]);

  // `withSessionToken` because this URL is set on `<audio src>`: a media element
  // request is issued by the browser, so it cannot carry the session header and
  // bypasses the fetch shim. Without the token the server 401s the stream and
  // playback fails with "playback could not start".
  const streamUrl = localSrc ?? withSessionToken(apiUrl(remoteUrl));

  const profileHeaders = (): Record<string, string> => {
    const profileId = window.localStorage.getItem("profileId");
    return profileId ? { "x-profile-id": profileId } : {};
  };

  const sessionRef = useRef<{ fromPosition: number; startedAt: string } | null>(null);
  // Mirror of sessionRef's start position in state, so the timeline can draw
  // the "you started here" marker. A ref alone would not re-render.
  const [sessionStart, setSessionStart] = useState<number | null>(null);
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
      body: JSON.stringify({ fromPosition: session.fromPosition, toPosition, speed: speedRef.current, startedAt: session.startedAt, endedAt: new Date().toISOString() }),
    }).catch(() => undefined);
  };

  const saveProgress = (position: number, onSettled?: () => void) => {
    // `onSettled` lets the shell refetch the library once the *final* save has
    // actually landed. Without it the library would be refetched on a guessed
    // delay and race this fire-and-forget keepalive request.
    void fetch(`/api/audiobooks/${book.id}/progress`, {
      method: "PUT",
      keepalive: true,
      headers: { "Content-Type": "application/json", ...profileHeaders() },
      body: JSON.stringify({ position }),
    }).catch(() => undefined).then(() => onSettled?.());
  };

  // Restore saved resume position once per book.
  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/audiobooks/${book.id}/progress`, { headers: profileHeaders() })
      .then((res) => (res.ok ? res.json() : { position: 0 }))
      .then(({ position }: { position: number }) => {
        if (cancelled || !position || position <= 0) return;
        // The user may have already started playing or picked a chapter
        // while this request was in flight. Their choice wins.
        if (userInteractedRef.current) return;
        let remaining = position;
        let index = 0;
        if (isChapterBook) {
          // Chapter offsets are absolute file times from ffprobe, not a
          // cumulative sum, so a position must be located by range. Subtracting
          // durations and re-adding the offset would overshoot by the offset
          // itself and could seek past the end of the file.
          const found = segments.findIndex((segment) => position >= segment.offset && position < segment.offset + segment.duration);
          index = found === -1 ? segments.length - 1 : found;
          remaining = position;
        } else {
          while (index < segments.length - 1 && remaining >= segments[index].duration) {
            remaining -= segments[index].duration;
            index += 1;
          }
        }
        const seekTarget = isChapterBook ? position : remaining;
        pendingSeekRef.current = seekTarget;
        desiredTimeRef.current = seekTarget;
        // Lock until the seek lands, so a stray timeupdate from the outgoing
        // track cannot overwrite the target with a near-zero value.
        desiredTimeLockedRef.current = true;
        const trackChanged = index !== currentIndexRef.current;
        setCurrentIndex(index);
        // Apply immediately only when the current source is already the
        // requested segment. On a track change, streamUrl still points at
        // the old source until React commits the new index; seeking it now
        // would be discarded by the following audio.load().
        const audio = audioRef.current;
        if (audio && !trackChanged && audio.readyState >= 1) {
          audio.currentTime = seekTarget;
          setCurrentTime(seekTarget);
          pendingSeekRef.current = null;
        }
        // else: `loadedmetadata` (or the post-load resume) applies it.
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);

  // Periodic progress save while playing (spec 04: report every ~10s).
  useEffect(() => {
    if (!playing) return;
    openSession(overallPositionRef.current);
    const timer = window.setInterval(() => saveProgress(overallPositionRef.current), 10_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  // Flush progress + session when pausing or the page unloads.
  useEffect(() => {
    const onPauseAndSave = () => {
      // Two cases where a `pause` must NOT be treated as the user stopping:
      // 1. Setting/changing a source emits a synthetic `pause` even when the
      //    user never started playback.
      // 2. While swapping tracks the render closure's position still refers
      //    to the *old* track, so saving here would record a position in the
      //    new track that was never played.
      if (!sessionRef.current || switchingSourceRef.current) return;
      saveProgress(overallPosition);
      flushSession(overallPosition);
    };
    const audio = audioRef.current;
    audio?.addEventListener("pause", onPauseAndSave);
    window.addEventListener("pagehide", onPauseAndSave);
    // Mobile browsers do not reliably fire pagehide when an app is
    // backgrounded, and the page may then be frozen or discarded, so also
    // flush when the tab becomes hidden.
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") onPauseAndSave();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      audio?.removeEventListener("pause", onPauseAndSave);
      window.removeEventListener("pagehide", onPauseAndSave);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overallPosition]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const updateTime = () => {
      setCurrentTime(audio.currentTime);
      if (isChapterBook) {
        const index = segments.findIndex((segment) => audio.currentTime >= segment.offset && audio.currentTime < segment.offset + segment.duration);
        if (index !== -1) setCurrentIndex(index);
        if (stopAtChapterEndRef.current) {
          const segment = segments[currentIndex];
          if (segment && audio.currentTime >= segment.offset + segment.duration - 0.05) {
            stopAtChapterEndRef.current = false;
            audio.pause();
            setSleepMinutes(null);
          }
        }
      }
    };
    const onPlay = () => {
      openSession(overallPositionRef.current);
      setPlaying(true);
      setError("");
    };
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      saveProgress(overallPosition);
      flushSession(overallPosition);
      if (stopAtChapterEndRef.current) {
        stopAtChapterEndRef.current = false;
        setShouldPlay(false);
        setPlaying(false);
        return;
      }
      if (currentIndex < segments.length - 1) {
        setShouldPlay(true);
        setCurrentIndex((index) => index + 1);
      } else {
        setShouldPlay(false);
        setPlaying(false);
        void fetch(`/api/audiobooks/${book.id}/progress`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...profileHeaders() },
          body: JSON.stringify({ position: totalDuration, completed: true }),
        }).catch(() => undefined);
      }
    };
    const onError = () => { setPlaying(false); setShouldPlay(false); setError(copy.player.audioLoadFailed); };
    const applyPendingSeek = () => {
      if (pendingSeekRef.current === null) return;
      const target = pendingSeekRef.current;
      audio.currentTime = target;
      setCurrentTime(target);
      desiredTimeRef.current = target;
      desiredTimeLockedRef.current = true;
      pendingSeekRef.current = null;
    };
    const onLoadedMetadata = () => {
      // A `loadedmetadata` can still arrive for the source we just replaced.
      // Seeking there would target the outgoing track. Only act on the
      // source currently set.
      if (audio.currentSrc && activeSrcRef.current && !audio.currentSrc.endsWith(activeSrcRef.current)) return;
      // Re-assert a seek that a redundant load() may have discarded. Only
      // while a seek is genuinely outstanding, so playback near the target is
      // not dragged backwards by a stale value.
      if (desiredTimeRef.current !== null && desiredTimeLockedRef.current && Math.abs(audio.currentTime - desiredTimeRef.current) > 1) {
        audio.currentTime = desiredTimeRef.current;
        setCurrentTime(desiredTimeRef.current);
        // The seek is applied here, so the pending request is satisfied. If
        // it is left set, the unmount cleanup treats the player as
        // "still restoring" and refuses to save a perfectly good position.
        pendingSeekRef.current = null;
        return;
      }
      applyPendingSeek();
    };
    const onSeeked = () => {
      // Only a seek on the source currently loaded may clear the target. A
      // `seeked` fired by the track we are leaving would otherwise discard the
      // incoming track's pending seek, leaving playback at the track start.
      if (audio.currentSrc && activeSrcRef.current && !audio.currentSrc.endsWith(activeSrcRef.current)) return;
      if (!desiredTimeLockedRef.current) return;
      desiredTimeRef.current = null;
      desiredTimeLockedRef.current = false;
    };
    audio.addEventListener("timeupdate", updateTime);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("seeked", onSeeked);
    return () => {
      audio.removeEventListener("timeupdate", updateTime);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("seeked", onSeeked);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, segments.length]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!isChapterBook) setCurrentTime(0);
    setError("");
    switchingSourceRef.current = true;
    activeSrcRef.current = streamUrl;
    audio.src = streamUrl;
    // Re-seek after load(): StrictMode runs this effect twice, and the second
    // load() resets currentTime to 0. The pending seek is reapplied on
    // `loadedmetadata`; this covers the case where that event has already
    // fired for this source.
    const resume = desiredTimeLockedRef.current ? desiredTimeRef.current : null;
    audio.load();
    if (resume !== null && audio.readyState >= 1) {
      audio.currentTime = resume;
      setCurrentTime(resume);
    }
    // Clear on the next tick: the synthetic pause fires as part of load().
    window.setTimeout(() => { switchingSourceRef.current = false; }, 0);
    if (shouldPlay) void audio.play().catch(() => { setShouldPlay(false); setError(copy.player.playbackCouldNotStart); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamUrl]);

  // Capture the element while mounted; React clears refs before passive
  // effect cleanup runs during unmount.
  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      if (!audio) return;
      const activeSegment = segments[currentIndexRef.current];
      const position = tracks.length > 0
        ? (activeSegment?.offset ?? 0) + audio.currentTime
        : audio.currentTime;
      // Never let a player that has not played anything overwrite a saved
      // resume position with the initial zero. Merely opening a book mounts
      // this component at currentTime 0, and React StrictMode unmounts and
      // remounts it once in development — which used to wipe the stored
      // position before the restore could read it, so resume never happened.
      // A real session, or a genuine seek away from zero, is still saved.
      //
      // A restore that is still in flight means the seek has not been applied yet.
      // Saving then would persist the *start* of the resume track instead of
      // the resume point itself. A session that is genuinely open always
      // counts, because then `position` is a real listening position.
      const restoreInFlight = pendingSeekRef.current !== null && !sessionRef.current;
      if (!restoreInFlight && (sessionRef.current || position > 0)) {
        // Tell the shell when the last save has landed, so the library's
        // progress bars are not left showing a stale position.
        saveProgress(position, () => onProgressSavedRef.current?.());
        flushSession(position);
      }
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    };
  }, []);

  function selectSegment(index: number) {
    userInteractedRef.current = true;
    pendingSeekRef.current = null;
    desiredTimeRef.current = isChapterBook ? segments[index].offset : 0;
    desiredTimeLockedRef.current = true;
    setShouldPlay(true);
    if (index === currentIndex && audioRef.current) {
      if (isChapterBook) {
        audioRef.current.currentTime = segments[index].offset;
      } else {
        audioRef.current.currentTime = 0;
      }
      void audioRef.current.play().catch(() => setError(copy.player.playbackCouldNotStart));
      return;
    }
    if (isChapterBook && audioRef.current) {
      setCurrentIndex(index);
      audioRef.current.currentTime = segments[index].offset;
      void audioRef.current.play().catch(() => setError(copy.player.playbackCouldNotStart));
      return;
    }
    setCurrentIndex(index);
  }

  function togglePlayback() {
    const audio = audioRef.current;
    if (!audio || !profileId) return;
    userInteractedRef.current = true;
    if (audio.paused) {
      setShouldPlay(true);
      void audio.play().catch(() => setError(copy.player.playbackCouldNotStart));
    } else {
      setShouldPlay(false);
      audio.pause();
    }
  }

  function skip(delta: number) {
    const next = Math.max(0, Math.min(segments.length - 1, currentIndex + delta));
    if (next !== currentIndex) selectSegment(next);
  }

  function skipSeconds(delta: number) {
    const audio = audioRef.current;
    if (!audio) return;
    userInteractedRef.current = true;
    const next = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + delta));
    audio.currentTime = next;
    desiredTimeRef.current = next;
    desiredTimeLockedRef.current = true;
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
    stopAtChapterEndRef.current = false;
    setSleepMinutes(minutes);
    if (minutes === null) return;
    if (minutes === -1) {
      stopAtChapterEndRef.current = true;
      return;
    }
    sleepTimerRef.current = window.setTimeout(() => {
      audioRef.current?.pause();
      setShouldPlay(false);
      setSleepMinutes(null);
    }, minutes * 60_000);
  }

  // Apply playback speed to the audio element whenever it changes.
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speed, streamUrl]);

  /** Seconds moved by the in-app and lock-screen skip buttons, together. */
  const SKIP_SECONDS = 15;

  // Lock-screen / notification controls.
  //
  // Registered through the shared helper rather than inline against
  // `navigator.mediaSession`, because on Android the web handlers alone left the
  // platform MediaSession with `actions=0` -- the lock screen drew the scrubber
  // and no buttons at all. See mediaSession.ts for the full explanation.
  useEffect(() => {
    setMediaMetadata(current.title || book.title, book.author, book.title);
    const unregister = registerMediaSessionHandlers({
      play: () => void audioRef.current?.play(),
      pause: () => {
        // Clear shouldPlay too: leaving it true means a track that ends while
        // paused would auto-advance and start playing on its own.
        setShouldPlay(false);
        userInteractedRef.current = true;
        audioRef.current?.pause();
      },
      seekBackward: () => skipSeconds(-SKIP_SECONDS),
      seekForward: () => skipSeconds(SKIP_SECONDS),
      // Chapter navigation, which is what prev/next mean in an audiobook: the
      // in-app buttons call the same two functions.
      previousTrack: () => skip(-1),
      nextTrack: () => skip(1),
    });
    return unregister;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, book.title, book.author]);

  // Keep the platform session's playback state in step with the audio element.
  //
  // Driven off the element's own events rather than React state, because the
  // platform gates the play/pause buttons on this value (see mediaSession.ts) --
  // a stale value means no buttons, which is the bug being fixed here.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const publish = () => publishPlaybackState(audio.paused ? "paused" : "playing");
    const ended = () => publishPlaybackState("none");
    // The element may already be playing by the time this runs.
    publish();
    audio.addEventListener("play", publish);
    audio.addEventListener("pause", publish);
    audio.addEventListener("ended", ended);
    return () => {
      audio.removeEventListener("play", publish);
      audio.removeEventListener("pause", publish);
      audio.removeEventListener("ended", ended);
    };
  }, [streamUrl]);

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
          label={playing ? copy.player.pause : copy.player.play}
          onClick={togglePlayback}
          spin={playing}
          disabled={!profileId}
        >
          {playing ? (
            <Pause size={22} className="fill-white text-white" aria-hidden="true" />
          ) : (
            <Play size={22} className="translate-x-[1px] fill-white text-white" aria-hidden="true" />
          )}
        </Dome>

        <div className="flex items-center gap-2">
          <Btn
            variant="quiet"
            onClick={() => skip(-1)}
            aria-label={copy.player.previousChapter}
            disabled={currentIndex === 0}
            className="iconbtn"
          >
            <SkipBack size={17} aria-hidden="true" />
          </Btn>
          <Btn
            variant="quiet"
            onClick={() => skip(1)}
            aria-label={copy.player.nextChapter}
            disabled={currentIndex === segments.length - 1}
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
            {current.title || copy.player.trackFallback(currentIndex + 1)}
          </p>
          <p className="text-[12px] text-ink3 tnum">
            {segments.length > 1 ? `${described.heading} of ${segments.length}` : described.heading}
          </p>
        </div>
      </div>

      {!profileId && (
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
          {timeLabel(described.segmentElapsed)} {copy.player.intoThis(segmentKind === "tracks" ? "track" : "chapter")} · {Math.round(described.segmentPercent)}%
        </p>
        <p className="text-[12.5px] text-ink3 tnum" data-testid="book-readout">
          {Math.round(described.bookPercent)}% of the book · {remainingLabel(described.bookRemaining)}
        </p>
      </div>

      <div className="mt-2.5">
        <ProgressTimeline
          segments={segments}
          kind={segmentKind}
          total={totalDuration}
          value={described.bookPosition}
          sessionStart={sessionStart}
          segmentElapsed={described.segmentElapsed}
          segmentDuration={described.segmentDuration}
          segmentHeading={described.heading}
          onSeek={(target) => {
          userInteractedRef.current = true;
          const index = segments.findIndex((segment) => target < segment.offset + segment.duration);
          const targetIndex = index === -1 ? segments.length - 1 : index;
          const offset = target - segments[targetIndex].offset;
          if (targetIndex !== currentIndex) {
            if (isChapterBook && audioRef.current) {
              setCurrentIndex(targetIndex);
              audioRef.current.currentTime = target;
            } else {
              // Desired within-track offset for the *incoming* track. Set both
              // refs from the raw value: React re-renders before this effect
              // runs, and any timeupdate in between can overwrite the desired
              // value with the outgoing track's near-zero time.
              const desired = Math.max(0, offset);
              pendingSeekRef.current = desired;
              desiredTimeRef.current = desired;
              // Lock until `seeked`: the outgoing track's stray timeupdate
              // would otherwise overwrite the target with a near-zero value.
              desiredTimeLockedRef.current = true;
              setCurrentIndex(targetIndex);
              setShouldPlay(playing);
            }
          } else if (audioRef.current) {
            // Keep the pending and desired values in step with the direct
            // seek: while the new source is still loading, `loadedmetadata`
            // would otherwise apply a *stale* pending seek over this one.
            const target2 = isChapterBook ? target : Math.max(0, offset);
            if (!isChapterBook) pendingSeekRef.current = target2;
            desiredTimeRef.current = target2;
            audioRef.current.currentTime = target2;
          }
        }} />
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
                  {segment.title || `Track ${index + 1}`}
                </span>
                <span className="shrink-0 text-[11.5px] tnum opacity-80">
                  {index === currentIndex ? `${timeLabel(isChapterBook ? currentTime - current.offset : currentTime)} / ` : ""}
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
