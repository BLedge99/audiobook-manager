import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import { ChapterPlayer } from "./ChapterPlayer";
import type { Audiobook } from "../types";

const book: Audiobook = {
  id: 1,
  title: "Test Book",
  author: "Author",
  duration: 1000,
  fileFormat: "mp3",
  tracks: [],
  createdAt: new Date().toISOString(),
};

let playMock: ReturnType<typeof vi.fn>;

describe("ChapterPlayer", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ position: 0, completed: false }) }),
    ));
    playMock = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("blocks playback and explains why when no profile is selected", () => {
    render(<ChapterPlayer book={book} />);
    expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/select a profile/i);
  });

  it("allows playback when a profile is selected", () => {
    window.localStorage.setItem("profileId", "42");
    render(<ChapterPlayer book={book} />);
    expect(screen.getByRole("button", { name: "Play" })).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("saves the latest seek position when switching books immediately", () => {
    window.localStorage.setItem("profileId", "42");
    const fetchMock = vi.mocked(fetch);
    const { unmount } = render(<ChapterPlayer book={book} />);
    const audio = document.querySelector("audio") as HTMLAudioElement;
    audio.currentTime = 1800;

    unmount();

    const progressSave = fetchMock.mock.calls.find(([url, options]) =>
      url === `/api/audiobooks/${book.id}/progress` && options?.method === "PUT",
    );
    expect(progressSave).toBeDefined();
    expect(JSON.parse(String(progressSave?.[1]?.body))).toEqual({ position: 1800 });
  });

  /**
   * Regression: merely opening a book used to PUT {position: 0} on unmount,
   * destroying the saved resume position before the restore could read it.
   * React StrictMode mounts, unmounts and remounts, which made resume fail
   * every time in development.
   */
  it("does not overwrite a saved position when it never played", () => {
    window.localStorage.setItem("profileId", "42");
    const fetchMock = vi.mocked(fetch);
    const { unmount } = render(<ChapterPlayer book={book} />);
    const audio = document.querySelector("audio") as HTMLAudioElement;

    // The listener never pressed play, so there is nothing worth saving.
    audio.currentTime = 0;
    unmount();

    const progressSave = fetchMock.mock.calls.find(([url, options]) =>
      url === `/api/audiobooks/${book.id}/progress` && options?.method === "PUT",
    );
    expect(progressSave).toBeUndefined();
  });

  it("restores the saved position for the book it was stored against", async () => {
    window.localStorage.setItem("profileId", "42");
    // jsdom never loads media, so readyState stays 0 and the restore would
    // sit in pendingSeek waiting for a `loadedmetadata` that never arrives.
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", { configurable: true, get: () => 1 });
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (String(url).endsWith("/progress")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ position: 900, completed: false }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }));

    render(<ChapterPlayer book={book} />);

    // The restore fetch resolves and seeks the media element.
    await waitFor(() => {
      const audio = document.querySelector("audio") as HTMLAudioElement;
      expect(audio.currentTime).toBe(900);
    });
    expect(document.querySelector('input[aria-label="Audiobook progress"]')).toHaveValue("900");
  });

  /**
   * Regression: the restore fetch must not be applied to the wrong book, and
   * must not save a zero back over the position it just restored.
   */
  it("does not re-save zero after restoring a position", async () => {
    window.localStorage.setItem("profileId", "42");
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", { configurable: true, get: () => 1 });
    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      if (String(url).endsWith("/progress") && options?.method === "PUT") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ position: 900, completed: false }) });
      }
      if (String(url).endsWith("/progress")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ position: 900, completed: false }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { unmount } = render(<ChapterPlayer book={book} />);
    await waitFor(() => {
      const audio = document.querySelector("audio") as HTMLAudioElement;
      expect(audio.currentTime).toBe(900);
    });

    unmount();

    const savedPositions = fetchMock.mock.calls
      .filter(([url, options]) => String(url) === `/api/audiobooks/${book.id}/progress` && (options as RequestInit)?.method === "PUT")
      .map(([, options]) => JSON.parse(String((options as RequestInit).body)));
    for (const saved of savedPositions) {
      expect(saved.position).toBeGreaterThan(0);
    }
  });

  /**
   * Regression: seeking across a track boundary used to be silently lost. A
   * `loadedmetadata` or `seeked` event from the outgoing track consumed the
   * pending seek, so playback restarted at the top of the incoming track and
   * the saved position collapsed to that track's start offset.
   */
  it("lands a cross-track seek on the requested offset in the new track", async () => {
    window.localStorage.setItem("profileId", "42");
    const multiTrack: Audiobook = {
      ...book,
      duration: 2375,
      tracks: [
        { id: 11, trackNumber: 1, duration: 830 },
        { id: 12, trackNumber: 2, duration: 1545 },
      ],
    };
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", { configurable: true, get: () => 1 });
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ position: 0, completed: false }) })));

    const { container } = render(<ChapterPlayer book={multiTrack} />);
    const audio = container.querySelector("audio") as HTMLAudioElement;
    const slider = container.querySelector('input[aria-label="Audiobook progress"]') as HTMLInputElement;

    // 1800s overall lands in track 2 (offset 830) -> 970s into that track.
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setValue?.call(slider, "1800");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // The media element must be pointed at the new track, at the right offset.
    // (jsdom does no media loading, so `src` is checked rather than
    // `currentSrc`; the real cross-track seek is covered end-to-end by
    // e2e/progress-resume.spec.ts.)
    await waitFor(() => {
      expect(audio.getAttribute("src")).toBe("/api/tracks/12/stream");
      expect(audio.currentTime).toBeCloseTo(970, 0);
    });
    // And the displayed position is the overall one, not the within-track one.
    await waitFor(() => {
      expect(Number(slider.value)).toBeCloseTo(1800, 0);
    });
  });

  /**
   * Regression: when a chapter of a chapter book ends, `streamUrl` is identical
   * for every chapter (single file), so the `streamUrl` effect never re-fires
   * and `audio.play()` was never called -- playback stayed paused at the end of
   * the previous chapter. `onEnded` must seek to the next segment's offset and
   * play directly, mirroring `selectSegment`.
   */
  it("auto-advances to the next chapter and plays when a chapter ends", async () => {
    window.localStorage.setItem("profileId", "42");
    const chapterBook: Audiobook = {
      ...book,
      duration: 900,
      chapters: JSON.stringify([
        { start: 0, end: 300, title: "Chapter 1" },
        { start: 300, end: 600, title: "Chapter 2" },
        { start: 600, end: 900, title: "Chapter 3" },
      ]),
    };
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", { configurable: true, get: () => 1 });
    render(<ChapterPlayer book={chapterBook} />);
    const audio = document.querySelector("audio") as HTMLAudioElement;

    const endChapter = () =>
      act(() => { audio.dispatchEvent(new Event("ended")); });

    // End of chapter 1: seek to chapter 2's offset (300) and play.
    endChapter();
    expect(audio.currentTime).toBe(300);
    expect(playMock).toHaveBeenCalledTimes(1);

    // End of chapter 2: seek to chapter 3's offset (600) and play.
    endChapter();
    expect(audio.currentTime).toBe(600);
    expect(playMock).toHaveBeenCalledTimes(2);
  });

  /**
   * Regression: playback must stop at the last chapter rather than looping back
   * to the first.
   */
  it("stops at the last chapter instead of advancing past it", async () => {
    window.localStorage.setItem("profileId", "42");
    const chapterBook: Audiobook = {
      ...book,
      duration: 900,
      chapters: JSON.stringify([
        { start: 0, end: 300, title: "Chapter 1" },
        { start: 300, end: 600, title: "Chapter 2" },
        { start: 600, end: 900, title: "Chapter 3" },
      ]),
    };
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", { configurable: true, get: () => 1 });
    render(<ChapterPlayer book={chapterBook} />);
    const audio = document.querySelector("audio") as HTMLAudioElement;

    const endChapter = () =>
      act(() => { audio.dispatchEvent(new Event("ended")); });

    endChapter(); // ch 1 -> ch 2
    endChapter(); // ch 2 -> ch 3
    const callsBeforeLast = playMock.mock.calls.length;

    endChapter(); // ch 3 -> stop (no seek, no play)

    expect(audio.currentTime).toBe(600);
    expect(playMock.mock.calls.length).toBe(callsBeforeLast);
  });

  /**
   * Regression: picking a chapter of a chapter book must seek straight to that
   * chapter's offset and keep playing there. `selectSegment` sets `currentTime`
   * directly on the single stream source (the `streamUrl` effect never re-fires
   * for a chapter book), and the local-file resolution must not flicker
   * `streamUrl` and reload the media element back to track zero.
   */
  it("seeks to the chosen chapter and keeps playing instead of restarting", () => {
    window.localStorage.setItem("profileId", "42");
    const chapterBook: Audiobook = {
      ...book,
      duration: 900,
      chapters: JSON.stringify([
        { start: 0, end: 300, title: "Chapter 1" },
        { start: 300, end: 600, title: "Chapter 2" },
      ]),
    };
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", { configurable: true, get: () => 1 });
    render(<ChapterPlayer book={chapterBook} />);
    const audio = document.querySelector("audio") as HTMLAudioElement;

    fireEvent.click(screen.getByRole("button", { name: /Chapter 2/ }));

    // The seek lands on chapter 2's offset (300s), not the track start.
    expect(audio.currentTime).toBe(300);
    expect(audio.currentTime).not.toBe(0);
    expect(playMock).toHaveBeenCalled();
  });
});
