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

export function ChapterPlayer({ book }: { book: Audiobook }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const tracks = useMemo<Track[]>(() => book.tracks.length
    ? [...book.tracks].sort((a, b) => a.trackNumber - b.trackNumber)
    : [{ id: book.id, title: book.title, duration: book.duration, trackNumber: 1 }], [book]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [shouldPlay, setShouldPlay] = useState(false);
  const [error, setError] = useState("");
  const current = tracks[currentIndex];
  const totalDuration = tracks.reduce((sum, track) => sum + track.duration, 0) || book.duration;
  const overallPosition = tracks.slice(0, currentIndex).reduce((sum, track) => sum + track.duration, 0) + currentTime;
  const streamUrl = book.tracks.length ? `/api/tracks/${current.id}/stream` : `/api/audiobooks/${book.id}/stream`;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const updateTime = () => setCurrentTime(audio.currentTime);
    const onPlay = () => { setPlaying(true); setError(""); };
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      if (currentIndex < tracks.length - 1) {
        setShouldPlay(true);
        setCurrentIndex((index) => index + 1);
      } else {
        setShouldPlay(false);
        setPlaying(false);
      }
    };
    const onError = () => { setPlaying(false); setShouldPlay(false); setError("This audio file could not be loaded."); };
    const onLoadedMetadata = () => {
      if (pendingSeekRef.current !== null) {
        audio.currentTime = pendingSeekRef.current;
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
  }, [currentIndex, tracks.length]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentTime(0);
    setError("");
    audio.src = streamUrl;
    audio.load();
    if (shouldPlay) void audio.play().catch(() => { setShouldPlay(false); setError("Playback could not start. Try again."); });
  }, [streamUrl]);

  useEffect(() => () => {
    const audio = audioRef.current;
    if (audio) { audio.pause(); audio.removeAttribute("src"); audio.load(); }
  }, []);

  function selectTrack(index: number) {
    setShouldPlay(true);
    if (index === currentIndex && audioRef.current) {
      audioRef.current.currentTime = 0;
      void audioRef.current.play().catch(() => setError("Playback could not start. Try again."));
      return;
    }
    setCurrentIndex(index);
  }

  function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      setShouldPlay(true);
      void audio.play().catch(() => setError("Playback could not start. Try again."));
    } else {
      setShouldPlay(false);
      audio.pause();
    }
  }

  function skip(delta: number) {
    const next = Math.max(0, Math.min(tracks.length - 1, currentIndex + delta));
    if (next !== currentIndex) selectTrack(next);
  }

  return (
    <section className="mt-8 rounded-lg border border-slate-700 bg-slate-950/50 p-4" aria-label="Audiobook player">
      <audio ref={audioRef} preload="metadata" />
      <div className="flex items-center gap-3">
        <button type="button" onClick={togglePlayback} aria-label={playing ? "Pause" : "Play"} className="rounded-full bg-cyan-400 p-3 text-slate-950 hover:bg-cyan-300">
          {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
        </button>
        <button type="button" onClick={() => skip(-1)} aria-label="Previous chapter" disabled={currentIndex === 0} className="rounded p-2 text-slate-300 hover:text-white disabled:opacity-40"><SkipBack size={18} /></button>
        <button type="button" onClick={() => skip(1)} aria-label="Next chapter" disabled={currentIndex === tracks.length - 1} className="rounded p-2 text-slate-300 hover:text-white disabled:opacity-40"><SkipForward size={18} /></button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{current.title || `Track ${current.trackNumber}`}</p>
          <p className="text-xs text-slate-400">Chapter {currentIndex + 1} of {tracks.length}</p>
        </div>
      </div>
      <div className="mt-4">
        <input aria-label="Audiobook progress" type="range" min={0} max={totalDuration || 1} step={1} value={Math.min(overallPosition, totalDuration)} onChange={(event) => {
          const target = Number(event.target.value);
          const index = tracks.findIndex((track, position) => target < tracks.slice(0, position + 1).reduce((sum, item) => sum + item.duration, 0));
          const targetIndex = index === -1 ? tracks.length - 1 : index;
          const offset = target - tracks.slice(0, targetIndex).reduce((sum, item) => sum + item.duration, 0);
          if (targetIndex !== currentIndex) {
            pendingSeekRef.current = Math.max(0, offset);
            setCurrentIndex(targetIndex);
            setShouldPlay(playing);
          } else if (audioRef.current) audioRef.current.currentTime = Math.max(0, offset);
        }} className="w-full accent-cyan-400" />
        <div className="flex justify-between text-xs text-slate-400"><span>{timeLabel(overallPosition)}</span><span>{timeLabel(totalDuration)}</span></div>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
      {tracks.length > 1 && <ol className="mt-4 max-h-48 divide-y divide-slate-800 overflow-auto">
        {tracks.map((track, index) => <li key={track.id}>
          <button type="button" onClick={() => selectTrack(index)} className={`flex w-full items-center justify-between gap-4 py-2 text-left text-sm hover:text-white ${index === currentIndex ? "text-cyan-300" : "text-slate-300"}`} aria-current={index === currentIndex ? "true" : undefined}>
            <span className="min-w-0 truncate"><span className="mr-2 text-slate-500">{track.trackNumber}.</span>{track.title || `Track ${track.trackNumber}`}</span>
            <span className="shrink-0 text-xs text-slate-500">{index === currentIndex ? `${timeLabel(currentTime)} / ` : ""}{timeLabel(track.duration)}</span>
          </button>
        </li>)}
      </ol>}
    </section>
  );
}
