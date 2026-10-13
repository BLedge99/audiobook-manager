import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { MediaSession } from "@capgo/capacitor-media-session";

/**
 * Sprint 1 spike — see `specs/26-android-app.md`.
 *
 * Two questions, nothing else:
 *   1. Does audio keep playing with the screen off?
 *   2. Does seeking land inside a file?
 *
 * Deliberately no Capacitor plugins. The web MediaSession API is the *worst
 * case* for background audio; if plain HTML audio survives the screen going off
 * on Android 13, no native media plugin is needed at all. If it does not, that
 * is the answer too, and it tells us exactly which plugin to add.
 *
 * Deleted once the native layer is proven.
 */
export function SpikePlayer() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setPosition(audio.currentTime);
    const onMeta = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
    };
  }, []);

  // Plugin calls are fire-and-forget, so a rejection is otherwise invisible:
  // the app looks fine while the native service silently never starts. Surface
  // them on the console, which Capacitor forwards to logcat, so the spike can
  // be diagnosed from `adb logcat` instead of guesswork.
  const call = (label: string, p: Promise<unknown>) =>
    p.catch((e) => console.error(`[spike] ${label} failed`, e));

  // Lock-screen controls. The first spike run proved the *web* MediaSession API
  // alone is not enough on Android 13: audio kept playing, but no media
  // notification appeared and there were no lock-screen transport controls,
  // because there was no foreground service behind it.
  //
  // `@capgo/capacitor-media-session` decorates the existing HTML audio element
  // rather than replacing the player, so the web fallback stays meaningful.
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      call(
        "setMetadata",
        MediaSession.setMetadata({
          title: "Spike: audio persistence test",
          artist: "Audiobook Manager",
          album: "Sprint 1",
        }),
      );
      call(
        "setActionHandler(play)",
        MediaSession.setActionHandler({ action: "play" }, () => void audioRef.current?.play()),
      );
      call(
        "setActionHandler(pause)",
        MediaSession.setActionHandler({ action: "pause" }, () => audioRef.current?.pause()),
      );
      return;
    }
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: "Spike: audio persistence test",
      artist: "Audiobook Manager",
      album: "Sprint 1",
    });
    navigator.mediaSession.setActionHandler("play", () => void audioRef.current?.play());
    navigator.mediaSession.setActionHandler("pause", () => audioRef.current?.pause());
    return () => {
      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("pause", null);
    };
  }, []);

  // Keep the native session's transport state in step with the element.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    call(
      "setPlaybackState",
      MediaSession.setPlaybackState({ playbackState: playing ? "playing" : "paused" }),
    );
    call(
      "setPositionState",
      MediaSession.setPositionState({
        duration: Number.isFinite(duration) ? duration : 0,
        playbackRate: 1,
        position,
      }),
    );
  }, [playing, position, duration]);

  const seekTo = (fraction: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration)) return;
    audio.currentTime = audio.duration * fraction;
    setPosition(audio.currentTime);
  };

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif", color: "#e2e8f0" }}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>Sprint 1 — spike</h1>
      <p style={{ color: "#94a3b8", fontSize: 13, marginBottom: 20 }}>
        Does it play with the screen off? Does seeking land?
      </p>

      <audio ref={audioRef} src="/spike/audio.mp3" preload="auto" />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        <button onClick={() => void audioRef.current?.play()} style={btn}>Play</button>
        <button onClick={() => audioRef.current?.pause()} style={btn}>Pause</button>
        <button onClick={() => seekTo(0.25)} style={btn}>Seek 25%</button>
        <button onClick={() => seekTo(0.5)} style={btn}>Seek 50%</button>
        <button onClick={() => seekTo(0.9)} style={btn}>Seek 90%</button>
      </div>

      <p style={{ fontFamily: "monospace", fontSize: 15 }}>
        {playing ? "PLAYING" : "paused"} · {fmt(position)} / {fmt(duration)}
      </p>

      <p style={{ color: "#64748b", fontSize: 12, marginTop: 24, maxWidth: 460 }}>
        Checklist: play it, lock the screen, wait 5 minutes, unlock. It must still be playing
        and the position must have advanced. Then seek to 50% and confirm it lands there.
      </p>
    </main>
  );
}

const btn: React.CSSProperties = {
  padding: "10px 16px",
  background: "#1e293b",
  color: "#e2e8f0",
  border: "1px solid #334155",
  borderRadius: 6,
  fontSize: 14,
  cursor: "pointer",
};

function fmt(seconds: number): string {
  if (!Number.isFinite(seconds)) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}