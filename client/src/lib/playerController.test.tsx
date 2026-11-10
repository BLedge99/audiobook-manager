import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { usePlayerController, SKIP_SECONDS } from "./playerController";
import type { Audiobook } from "../types";

const chapterBook: Audiobook = {
  id: 1,
  title: "Controller Test Book",
  author: "Author",
  duration: 900,
  fileFormat: "m4b",
  tracks: [{ id: 41, trackNumber: 1, duration: 900 }],
  chapters: JSON.stringify([
    { start: 0, end: 300, title: "Chapter 1" },
    { start: 300, end: 600, title: "Chapter 2" },
    { start: 600, end: 900, title: "Chapter 3" },
  ]),
  createdAt: new Date().toISOString(),
};

describe("usePlayerController", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ position: 0, completed: false }) }),
    ));
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
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

  it("initializes with position 0, derived segments, and plan", () => {
    const { result } = renderHook(() => usePlayerController({ book: chapterBook, profileId: "user-1" }));

    expect(result.current.position).toBe(0);
    expect(result.current.pending).toBeNull();
    expect(result.current.displayPosition).toBe(0);
    expect(result.current.playing).toBe(false);
    expect(result.current.playIntent).toBe(false);
    expect(result.current.activeProfileId).toBe("user-1");
    expect(result.current.segments).toHaveLength(3);
    expect(result.current.total).toBe(900);
    expect(result.current.described.segmentIndex).toBe(0);
    expect(result.current.described.title).toBe("Chapter 1");
  });

  it("enforces ADR 017: goTo updates position and derives corresponding segment plan", () => {
    const { result } = renderHook(() => usePlayerController({ book: chapterBook, profileId: "user-1" }));

    act(() => {
      result.current.goTo(350);
    });

    expect(result.current.position).toBe(350);
    expect(result.current.pending).toBe(350);
    expect(result.current.displayPosition).toBe(350);
    expect(result.current.described.segmentIndex).toBe(1);
    expect(result.current.described.title).toBe("Chapter 2");
    expect(result.current.described.segmentElapsed).toBe(50);
  });

  it("does not start playback when no profile is active", () => {
    const { result } = renderHook(() => usePlayerController({ book: chapterBook, profileId: null }));

    act(() => {
      result.current.togglePlayback();
    });

    expect(result.current.playIntent).toBe(false);
  });

  it("toggles play intent when a profile is active", () => {
    const { result } = renderHook(() => usePlayerController({ book: chapterBook, profileId: "42" }));

    act(() => {
      result.current.togglePlayback();
    });
    expect(result.current.playIntent).toBe(true);

    act(() => {
      result.current.togglePlayback();
    });
    expect(result.current.playIntent).toBe(false);
  });

  it("skips seconds forward and backward relative to book position", () => {
    const { result } = renderHook(() => usePlayerController({ book: chapterBook, profileId: "42" }));

    act(() => {
      result.current.goTo(100);
    });
    expect(result.current.displayPosition).toBe(100);

    act(() => {
      result.current.skipSeconds(SKIP_SECONDS);
    });
    expect(result.current.displayPosition).toBe(115);

    act(() => {
      result.current.skipSeconds(-SKIP_SECONDS);
    });
    expect(result.current.displayPosition).toBe(100);
  });

  it("skips segments forward and backward", () => {
    const { result } = renderHook(() => usePlayerController({ book: chapterBook, profileId: "42" }));

    act(() => {
      result.current.skipSegment(1);
    });
    expect(result.current.displayPosition).toBe(300);
    expect(result.current.described.segmentIndex).toBe(1);

    act(() => {
      result.current.skipSegment(-1);
    });
    expect(result.current.displayPosition).toBe(0);
    expect(result.current.described.segmentIndex).toBe(0);
  });

  it("selects a specific segment by index", () => {
    const { result } = renderHook(() => usePlayerController({ book: chapterBook, profileId: "42" }));

    act(() => {
      result.current.selectSegment(2);
    });
    expect(result.current.displayPosition).toBe(600);
    expect(result.current.described.segmentIndex).toBe(2);
    expect(result.current.described.title).toBe("Chapter 3");
  });

  it("updates speed and persists to localStorage", () => {
    const { result } = renderHook(() => usePlayerController({ book: chapterBook, profileId: "42" }));

    act(() => {
      result.current.changeSpeed(1.5);
    });
    expect(result.current.speed).toBe(1.5);
    expect(window.localStorage.getItem("playbackRate")).toBe("1.5");
  });

  it("sets sleep timer and arms chapter-end boundary", () => {
    const { result } = renderHook(() => usePlayerController({ book: chapterBook, profileId: "42" }));

    act(() => {
      result.current.goTo(50);
      result.current.setSleepTimer(-1);
    });
    expect(result.current.sleepMinutes).toBe(-1);

    act(() => {
      result.current.setSleepTimer(null);
    });
    expect(result.current.sleepMinutes).toBeNull();
  });

  it("restores saved progress on mount when user has not interacted", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (String(url).endsWith("/progress")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ position: 450, completed: false }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }));

    const { result } = renderHook(() => usePlayerController({ book: chapterBook, profileId: "42" }));

    await waitFor(() => {
      expect(result.current.displayPosition).toBe(450);
    });
  });

  it("saves progress on unmount when position > 0", () => {
    const fetchMock = vi.mocked(fetch);
    const { result, unmount } = renderHook(() => usePlayerController({ book: chapterBook, profileId: "42" }));

    act(() => {
      result.current.goTo(250);
    });

    unmount();

    const progressSave = fetchMock.mock.calls.find(([url, options]) =>
      url === `/api/audiobooks/${chapterBook.id}/progress` && options?.method === "PUT",
    );
    expect(progressSave).toBeDefined();
    expect(JSON.parse(String(progressSave?.[1]?.body))).toEqual({ position: 250 });
  });
});
