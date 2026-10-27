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

/** One file with embedded chapters -- the shape that broke the old player. */
const chapterBook: Audiobook = {
  ...book,
  duration: 900,
  tracks: [{ id: 41, trackNumber: 1, duration: 900 }],
  chapters: JSON.stringify([
    { start: 0, end: 300, title: "One" },
    { start: 300, end: 600, title: "Two" },
    { start: 600, end: 900, title: "Three" },
  ]),
};

/** Many files, no chapters -- the shape the old player was built for. */
const trackBook: Audiobook = {
  ...book,
  duration: 2375,
  tracks: [
    { id: 11, trackNumber: 1, duration: 830 },
    { id: 12, trackNumber: 2, duration: 1545 },
  ],
};

let playMock: ReturnType<typeof vi.fn>;
let pauseMock: ReturnType<typeof vi.fn>;

const audioOf = () => document.querySelector("audio") as HTMLAudioElement;
const sliderOf = () => document.querySelector('input[aria-label="Audiobook progress"]') as HTMLInputElement;

/** Wait until the player has a source, which is what the load effect keys on. */
const waitForSource = (src: string) =>
  waitFor(() => expect(audioOf().getAttribute("src")).toBe(src));

const dragTo = async (value: number) => {
  const slider = sliderOf();
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setValue?.call(slider, String(value));
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const tick = (currentTime: number) => {
  act(() => {
    audioOf().currentTime = currentTime;
    audioOf().dispatchEvent(new Event("timeupdate"));
  });
};

describe("ChapterPlayer", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ position: 0, completed: false }) }),
    ));
    playMock = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    pauseMock = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
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

  /**
   * The player must take the profile from the app, not only from storage: a
   * session the server restored from a cookie never wrote `profileId`, and
   * reading it once at mount left Play disabled for a signed-in listener.
   */
  it("takes the profile from the app rather than from storage", () => {
    render(<ChapterPlayer book={book} profileId="7" />);
    expect(screen.getByRole("button", { name: "Play" })).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("never leaves the media element without a source", async () => {
    window.localStorage.setItem("profileId", "42");
    render(<ChapterPlayer book={chapterBook} />);
    await waitForSource("/api/audiobooks/1/stream");
    expect(audioOf().getAttribute("src")).not.toBe("");
  });

  it("saves the latest seek position when switching books immediately", () => {
    window.localStorage.setItem("profileId", "42");
    const fetchMock = vi.mocked(fetch);
    const { unmount } = render(<ChapterPlayer book={book} />);
    const audio = audioOf();
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
    const audio = audioOf();

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
    // wait for a `loadedmetadata` that never arrives.
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
      expect(audioOf().currentTime).toBe(900);
    });
    expect(sliderOf()).toHaveValue("900");
  });

  /**
   * Regression: the restore fetch must not be applied to the wrong book, and
   * must not save a zero back over the position it just restored.
   */
  it("does not re-save zero after restoring a position", async () => {
    window.localStorage.setItem("profileId", "42");
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", { configurable: true, get: () => 1 });
    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      // The GET restores; the PUT must never write a zero back.
      if (String(url).endsWith("/progress") && options?.method !== "PUT") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ position: 900, completed: false }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { unmount } = render(<ChapterPlayer book={book} />);
    await waitFor(() => {
      expect(audioOf().currentTime).toBe(900);
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
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", { configurable: true, get: () => 1 });

    render(<ChapterPlayer book={trackBook} />);
    const audio = audioOf();
    await waitForSource("/api/tracks/11/stream");

    // 1800s overall lands in track 2 (offset 830) -> 970s into that track.
    await dragTo(1800);

    await waitFor(() => {
      expect(audio.getAttribute("src")).toBe("/api/tracks/12/stream");
      expect(audio.currentTime).toBeCloseTo(970, 0);
    });
    // And the displayed position is the overall one, not the within-track one.
    expect(Number(sliderOf().value)).toBeCloseTo(1800, 0);
  });

  /**
   * Regression (the "head jumps back to the start" bug): while a seek into a
   * different file is in flight, the outgoing file keeps reporting its own
   * position. The readout must keep showing the requested position until the
   * element actually gets there.
   */
  it("never shows a position behind the seek while the new source loads", async () => {
    window.localStorage.setItem("profileId", "42");
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", { configurable: true, get: () => 1 });

    render(<ChapterPlayer book={trackBook} />);
    const audio = audioOf();
    await waitForSource("/api/tracks/11/stream");

    await dragTo(1800);
    await waitForSource("/api/tracks/12/stream");

    // A stray timeupdate from the file we just left.
    tick(5);
    expect(Number(sliderOf().value)).toBeCloseTo(1800, 0);

    // The same media, now at the requested place: pending is satisfied and the
    // readout stays where the listener put it.
    tick(970);
    expect(Number(sliderOf().value)).toBeCloseTo(1800, 0);
    expect(audio.getAttribute("src")).toBe("/api/tracks/12/stream");
  });

  /**
   * The chapter book's advance mechanism, and the one the old player never had:
   * crossing a chapter boundary is a *position* change inside one file. No
   * URL changes, nothing reloads, playback is not interrupted.
   */
  it("moves into the next chapter as the position crosses the boundary", async () => {
    window.localStorage.setItem("profileId", "42");
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", { configurable: true, get: () => 1 });

    render(<ChapterPlayer book={chapterBook} />);
    const audio = audioOf();
    await waitForSource("/api/audiobooks/1/stream");
    const srcBefore = audio.getAttribute("src");
    const pausesBefore = pauseMock.mock.calls.length;

    tick(310);

    await waitFor(() => expect(screen.getByTestId("position-readout")).toHaveTextContent("Two"));
    // Seamless: the same file is still loaded and playback was not paused.
    expect(audio.getAttribute("src")).toBe(srcBefore);
    expect(pauseMock.mock.calls.length).toBe(pausesBefore);
    expect(Number(sliderOf().value)).toBeCloseTo(310, 0);
  });

  /**
   * A chapter book is one file, so `ended` means the *book* ended. The old
   * `onEnded` advanced to the next chapter, which is unreachable in real use:
   * by the time the file ends, the position is already in the last chapter.
   */
  it("marks the book complete when the one file ends", async () => {
    window.localStorage.setItem("profileId", "42");
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", { configurable: true, get: () => 1 });
    const fetchMock = vi.mocked(fetch);

    render(<ChapterPlayer book={chapterBook} />);
    await waitForSource("/api/audiobooks/1/stream");

    act(() => {
      audioOf().currentTime = 900;
      audioOf().dispatchEvent(new Event("ended"));
    });

    const completion = fetchMock.mock.calls.find(([url, options]) =>
      String(url) === `/api/audiobooks/1/progress` &&
      (options as RequestInit | undefined)?.method === "PUT" &&
      JSON.parse(String((options as RequestInit).body)).completed === true,
    );
    await waitFor(() => expect(completion).toBeDefined());
    expect(JSON.parse(String(completion?.[1]?.body)).position).toBe(900);
  });

  /**
   * A book of many files keeps the old behaviour: the end of one file loads the
   * next one. It must not advance twice, because the element's clock at the end
   * of track 1 reads that track's duration -- which is where track 2 *starts*.
   */
  it("advances to the next track when a track ends", async () => {
    window.localStorage.setItem("profileId", "42");
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", { configurable: true, get: () => 1 });

    render(<ChapterPlayer book={trackBook} />);
    await waitForSource("/api/tracks/11/stream");

    act(() => {
      audioOf().currentTime = 830;
      audioOf().dispatchEvent(new Event("ended"));
    });

    await waitForSource("/api/tracks/12/stream");
    expect(playMock).toHaveBeenCalled();
  });

  it("stops at the end of the chapter the sleep timer was set in", async () => {
    window.localStorage.setItem("profileId", "42");
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", { configurable: true, get: () => 1 });

    render(<ChapterPlayer book={chapterBook} />);
    await waitForSource("/api/audiobooks/1/stream");

    fireEvent.change(screen.getByLabelText("Sleep timer"), { target: { value: "-1" } });
    const pausesBefore = pauseMock.mock.calls.length;

    // Still inside chapter 1: keep going.
    tick(299);
    expect(pauseMock.mock.calls.length).toBe(pausesBefore);

    // Chapter 1 ends: stop, and disarm the timer.
    tick(300);
    expect(pauseMock.mock.calls.length).toBeGreaterThan(pausesBefore);
    expect(screen.getByLabelText("Sleep timer")).toHaveValue("off");
  });

  /**
   * Picking a chapter of a single-file book must seek within the file it
   * already has. Changing the source here is what used to discard the seek and
   * restart at the beginning of the file.
   */
  it("seeks to the chosen chapter without reloading the source", async () => {
    window.localStorage.setItem("profileId", "42");
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", { configurable: true, get: () => 1 });

    render(<ChapterPlayer book={chapterBook} />);
    const audio = audioOf();
    await waitForSource("/api/audiobooks/1/stream");
    const srcBefore = audio.getAttribute("src");

    fireEvent.click(screen.getByRole("button", { name: /Two/ }));

    // The seek lands on chapter 2's offset (300s), not the start of the file.
    expect(audio.currentTime).toBe(300);
    expect(audio.getAttribute("src")).toBe(srcBefore);
    expect(playMock).toHaveBeenCalled();
  });

  it("moves back and forward a chapter from the transport buttons", async () => {
    window.localStorage.setItem("profileId", "42");
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", { configurable: true, get: () => 1 });

    render(<ChapterPlayer book={chapterBook} />);
    const audio = audioOf();
    await waitForSource("/api/audiobooks/1/stream");

    fireEvent.click(screen.getByRole("button", { name: "Next chapter" }));
    expect(audio.currentTime).toBe(300);

    fireEvent.click(screen.getByRole("button", { name: "Previous chapter" }));
    expect(audio.currentTime).toBe(0);
  });

  it("skips 15 seconds without changing the source", async () => {
    window.localStorage.setItem("profileId", "42");
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", { configurable: true, get: () => 1 });

    render(<ChapterPlayer book={chapterBook} />);
    const audio = audioOf();
    await waitForSource("/api/audiobooks/1/stream");

    fireEvent.click(screen.getByRole("button", { name: /Forward 15 seconds/ }));
    expect(audio.currentTime).toBe(15);

    fireEvent.click(screen.getByRole("button", { name: /Back 15 seconds/ }));
    expect(audio.currentTime).toBe(0);
  });

  /**
   * Pressing Play before the source has resolved is legal, and on Android it is
   * what a listener actually does. Playback then starts from the load effect,
   * outside the click, so the browser's autoplay policy refuses it with
   * `NotAllowedError`. That is not a broken book: the source has arrived, and
   * the next tap plays synchronously. Reporting "Playback could not start"
   * here made a one-second race look like the dead player that was reported.
   */
  it("does not claim failure when the autoplay policy refuses a deferred play", async () => {
    window.localStorage.setItem("profileId", "42");
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", { configurable: true, get: () => 1 });
    playMock.mockRejectedValue(Object.assign(new Error("blocked"), { name: "NotAllowedError" }));

    render(<ChapterPlayer book={chapterBook} />);
    await waitForSource("/api/audiobooks/1/stream");

    fireEvent.click(screen.getByRole("button", { name: "Play" }));

    // Back to Play, and no error text: trying again is the whole remedy.
    await waitFor(() => expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reports a real play failure", async () => {
    window.localStorage.setItem("profileId", "42");
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", { configurable: true, get: () => 1 });
    playMock.mockRejectedValue(Object.assign(new Error("no source"), { name: "NotSupportedError" }));

    render(<ChapterPlayer book={chapterBook} />);
    await waitForSource("/api/audiobooks/1/stream");

    fireEvent.click(screen.getByRole("button", { name: "Play" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/could not start/i));
  });
});
