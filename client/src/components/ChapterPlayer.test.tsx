import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
