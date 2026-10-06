import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import type { Audiobook, Track } from "../types";

function timeLabel(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = Math.floor(seconds % 60);
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}` : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

type Segment = { key: string; title?: string; duration: number; offset: number; trackId?: number };

function parseChapters(book: Audiobook): { start: number; end: number; title: string }[] {
  if (!book.chapters) return [];
  try {
    const parsed = JSON.parse(book.chapters);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function ChapterPlayer({ book }: { book: Audiobook }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const pendingSeekRef = useRef<number | null>(null);
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
  const tracks = useMemo<Track[]>(() => book.tracks.length
    ? [...book.tracks].sort((a, b) => a.trackNumber - b.trackNumber)
    : [], [book]);
  const chapters = useMemo(() => parseChapters(book), [book]);
  const isChapterBook = tracks.length === 0 && chapters.length > 0;

  const segments = useMemo<Segment[]>(() => {
    if (tracks.length > 0) {
      let offset = 0;
      return tracks.map((track) => {
        const segment = { key: String(track.id), title: track.title, duration: track.duration, offset, trackId: track.id };
        offset += track.duration;
        return segment;
      });
    }
    if (chapters.length > 0) {
      return chapters.map((chapter, index) => ({ key: String(index), title: chapter.title, duration: chapter.end - chapter.start, offset: chapter.start }));
    }
    return [{ key: "full", title: book.title, duration: book.duration, offset: 0 }];
  }, [tracks, chapters, book]);

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
  const totalDuration = segments.reduce((sum, segment) => sum + segment.duration, 0) || book.duration;
  const overallPosition = (isChapterBook || tracks.length === 0) ? currentTime : segments[currentIndex].offset + currentTime;
  // Latest position for the periodic saver, which must not restart its
  // timer on every position tick (that would prevent it ever firing).
  const overallPositionRef = useRef(overallPosition);
  overallPositionRef.current = overallPosition;
  const streamUrl = isChapterBook
    ? `/api/audiobooks/${book.id}/stream`
    : tracks.length > 0
      ? `/api/tracks/${segments[currentIndex].trackId}/stream`
      : `/api/audiobooks/${book.id}/stream`;

  const profileHeaders = (): Record<string, string> => {
    const profileId = window.localStorage.getItem("profileId");
    return profileId ? { "x-profile-id": profileId } : {};
  };

  const sessionRef = useRef<{ fromPosition: number; startedAt: string } | null>(null);
  const flushSession = (toPosition: number) => {
    const session = sessionRef.current;
    sessionRef.current = null;
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

  const saveProgress = (position: number) => {
    void fetch(`/api/audiobooks/${book.id}/progress`, {
      method: "PUT",
      keepalive: true,
      headers: { "Content-Type": "application/json", ...profileHeaders() },
      body: JSON.stringify({ position }),
    }).catch(() => undefined);
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
    sessionRef.current = sessionRef.current ?? { fromPosition: overallPositionRef.current, startedAt: new Date().toISOString() };
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
      sessionRef.current = sessionRef.current ?? { fromPosition: overallPositionRef.current, startedAt: new Date().toISOString() };
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
    const onError = () => { setPlaying(false); setShouldPlay(false); setError("This audio file could not be loaded."); };
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
    if (shouldPlay) void audio.play().catch(() => { setShouldPlay(false); setError("Playback could not start. Try again."); });
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
        saveProgress(position);
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
      void audioRef.current.play().catch(() => setError("Playback could not start. Try again."));
      return;
    }
    if (isChapterBook && audioRef.current) {
      setCurrentIndex(index);
      audioRef.current.currentTime = segments[index].offset;
      void audioRef.current.play().catch(() => setError("Playback could not start. Try again."));
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
      void audio.play().catch(() => setError("Playback could not start. Try again."));
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

  // Media Session API: lock-screen / notification controls.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: current.title || book.title, artist: book.author, album: book.title });
    navigator.mediaSession.setActionHandler("play", () => void audioRef.current?.play());
    navigator.mediaSession.setActionHandler("pause", () => {
      // Clear shouldPlay too: leaving it true means a track that ends while
      // paused would auto-advance and start playing on its own.
      setShouldPlay(false);
      userInteractedRef.current = true;
      audioRef.current?.pause();
    });
    navigator.mediaSession.setActionHandler("seekbackward", () => skipSeconds(-15));
    navigator.mediaSession.setActionHandler("seekforward", () => skipSeconds(15));
    return () => {
      try {
        navigator.mediaSession.setActionHandler("play", null);
        navigator.mediaSession.setActionHandler("pause", null);
        navigator.mediaSession.setActionHandler("seekbackward", null);
        navigator.mediaSession.setActionHandler("seekforward", null);
      } catch { /* noop */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, book.title, book.author]);

  return (
    <section className="mt-8 rounded-lg border border-slate-700 bg-slate-950/50 p-4" aria-label="Audiobook player">
      <audio ref={audioRef} preload="metadata" />
      <div className="flex items-center gap-3">
        <button type="button" onClick={togglePlayback} disabled={!profileId} aria-label={playing ? "Pause" : "Play"} title={profileId ? undefined : "Select a profile first"} className="rounded-full bg-cyan-400 p-3 text-slate-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40">
          {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
        </button>
        <button type="button" onClick={() => skip(-1)} aria-label="Previous chapter" disabled={currentIndex === 0} className="rounded p-2 text-slate-300 hover:text-white disabled:opacity-40"><SkipBack size={18} /></button>
        <button type="button" onClick={() => skip(1)} aria-label="Next chapter" disabled={currentIndex === segments.length - 1} className="rounded p-2 text-slate-300 hover:text-white disabled:opacity-40"><SkipForward size={18} /></button>
        <button type="button" onClick={() => skipSeconds(-15)} aria-label="Back 15 seconds" className="rounded p-2 text-slate-300 hover:text-white">−15s</button>
        <button type="button" onClick={() => skipSeconds(15)} aria-label="Forward 15 seconds" className="rounded p-2 text-slate-300 hover:text-white">+15s</button>
        <select aria-label="Playback speed" value={speed} onChange={(event) => changeSpeed(Number(event.target.value))} className="border border-slate-700 bg-slate-950 px-2 py-1 text-sm">
          {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3].map((rate) => <option key={rate} value={rate}>{rate}x</option>)}
        </select>
        <select aria-label="Sleep timer" value={sleepMinutes ?? "off"} onChange={(event) => setSleepTimer(event.target.value === "off" ? null : Number(event.target.value))} className="border border-slate-700 bg-slate-950 px-2 py-1 text-sm">
          <option value="off">Sleep: off</option>
          <option value="15">15 min</option>
          <option value="30">30 min</option>
          <option value="60">60 min</option>
          <option value="-1">End of chapter</option>
        </select>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{current.title || `Track ${currentIndex + 1}`}</p>
          <p className="text-xs text-slate-400">Chapter {currentIndex + 1} of {segments.length}</p>
        </div>
      </div>
      {!profileId && (
        <p role="alert" className="mt-3 text-sm text-amber-300">
          Select a profile to start listening — your position is saved per profile.
        </p>
      )}
      <div className="mt-4">
        <input aria-label="Audiobook progress" type="range" min={0} max={totalDuration || 1} step={1} value={Math.min(overallPosition, totalDuration)} onChange={(event) => {
          userInteractedRef.current = true;
          const target = Number(event.target.value);
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
        }} className="w-full accent-cyan-400" />
        <div className="flex justify-between text-xs text-slate-400"><span>{timeLabel(overallPosition)}</span><span>{timeLabel(totalDuration)}</span></div>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
      {segments.length > 1 && <ol className="mt-4 max-h-48 divide-y divide-slate-800 overflow-auto">
        {segments.map((segment, index) => <li key={segment.key}>
          <button type="button" onClick={() => selectSegment(index)} className={`flex w-full items-center justify-between gap-4 py-2 text-left text-sm hover:text-white ${index === currentIndex ? "text-cyan-300" : "text-slate-300"}`} aria-current={index === currentIndex ? "true" : undefined}>
            <span className="min-w-0 truncate"><span className="mr-2 text-slate-500">{index + 1}.</span>{segment.title || `Track ${index + 1}`}</span>
            <span className="shrink-0 text-xs text-slate-500">{index === currentIndex ? `${timeLabel(isChapterBook ? currentTime - current.offset : currentTime)} / ` : ""}{timeLabel(segment.duration)}</span>
          </button>
        </li>)}
      </ol>}
    </section>
  );
}
