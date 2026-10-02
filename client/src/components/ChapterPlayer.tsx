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
    void fetch(`/api/audiobooks/${book.id}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...profileHeaders() },
      body: JSON.stringify({ fromPosition: session.fromPosition, toPosition, speed, startedAt: session.startedAt, endedAt: new Date().toISOString() }),
    }).catch(() => undefined);
  };

  const saveProgress = (position: number) => {
    void fetch(`/api/audiobooks/${book.id}/progress`, {
      method: "PUT",
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
        let remaining = position;
        let index = 0;
        while (index < segments.length - 1 && remaining >= segments[index].duration) {
          remaining -= segments[index].duration;
          index += 1;
        }
        const seekTarget = remaining + (isChapterBook ? segments[index].offset : 0);
        pendingSeekRef.current = seekTarget;
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
      // Setting/changing a source can emit `pause` even when the user never
      // started playback. Do not let that synthetic pause overwrite a saved
      // resume position with the initial zero.
      if (!sessionRef.current) return;
      saveProgress(overallPosition);
      flushSession(overallPosition);
    };
    const audio = audioRef.current;
    audio?.addEventListener("pause", onPauseAndSave);
    window.addEventListener("pagehide", onPauseAndSave);
    return () => {
      audio?.removeEventListener("pause", onPauseAndSave);
      window.removeEventListener("pagehide", onPauseAndSave);
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
    const onLoadedMetadata = () => {
      if (pendingSeekRef.current !== null) {
        audio.currentTime = pendingSeekRef.current;
        setCurrentTime(pendingSeekRef.current);
        pendingSeekRef.current = null;
      }
    };
    audio.addEventListener("timeupdate", updateTime);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    return () => {
      audio.removeEventListener("timeupdate", updateTime);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, segments.length]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!isChapterBook) setCurrentTime(0);
    setError("");
    audio.src = streamUrl;
    audio.load();
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
      saveProgress(position);
      flushSession(position);
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    };
  }, []);

  function selectSegment(index: number) {
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
    audio.currentTime = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + delta));
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
    navigator.mediaSession.setActionHandler("pause", () => audioRef.current?.pause());
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
          const target = Number(event.target.value);
          const index = segments.findIndex((segment) => target < segment.offset + segment.duration);
          const targetIndex = index === -1 ? segments.length - 1 : index;
          const offset = target - segments[targetIndex].offset;
          if (targetIndex !== currentIndex) {
            if (isChapterBook && audioRef.current) {
              setCurrentIndex(targetIndex);
              audioRef.current.currentTime = target;
            } else {
              pendingSeekRef.current = Math.max(0, offset);
              setCurrentIndex(targetIndex);
              setShouldPlay(playing);
            }
          } else if (audioRef.current) {
            audioRef.current.currentTime = isChapterBook ? target : Math.max(0, offset);
          }
        }} className="w-full accent-cyan-400" />
        <div className="flex justify-between text-xs text-slate-400"><span>{timeLabel(overallPosition)}</span><span>{timeLabel(totalDuration)}</span></div>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
      {segments.length > 1 && <ol className="mt-4 max-h-48 divide-y divide-slate-800 overflow-auto">
        {segments.map((segment, index) => <li key={segment.key}>
          <button type="button" onClick={() => selectSegment(index)} className={`flex w-full items-center justify-between gap-4 py-2 text-left text-sm hover:text-white ${index === currentIndex ? "text-cyan-300" : "text-slate-300"}`} aria-current={index === currentIndex ? "true" : undefined}>
            <span className="min-w-0 truncate"><span className="mr-2 text-slate-500">{index + 1}.</span>{segment.title || `Track ${index + 1}`}</span>
            <span className="shrink-0 text-xs text-slate-500">{index === currentIndex ? `${timeLabel(currentTime - (isChapterBook ? 0 : 0))} / ` : ""}{timeLabel(segment.duration)}</span>
          </button>
        </li>)}
      </ol>}
    </section>
  );
}
