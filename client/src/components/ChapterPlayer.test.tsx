import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ChapterPlayer } from "./ChapterPlayer";
import type { Audiobook } from "../types";

const book: Audiobook = {
  id: 1,
  title: "Test Book",
  author: "Author",
  duration: 1000,
  fileFormat: "mp3",
  filePath: "/lib/book.mp3",
  tracks: [],
  createdAt: new Date().toISOString(),
};

describe("ChapterPlayer", () => {
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
});
