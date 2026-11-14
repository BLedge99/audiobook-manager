import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AudiobookGrid } from "./AudiobookGrid";
import type { Audiobook } from "../types";

const book: Audiobook = {
  id: 1,
  title: "The Tell-Tale Heart",
  author: "Edgar Allan Poe",
  duration: 3660,
  fileFormat: "mp3",
  tracks: [{ id: 1, duration: 3660, trackNumber: 1 }],
  createdAt: new Date().toISOString(),
};

describe("AudiobookGrid", () => {
  it("shows an empty state when there are no books", () => {
    render(<AudiobookGrid books={[]} onSelect={() => {}} />);
    expect(screen.getByText(/library is empty/i)).toBeInTheDocument();
  });

  it("renders book cards with title and duration", () => {
    render(<AudiobookGrid books={[book]} onSelect={() => {}} />);
    expect(screen.getByText("The Tell-Tale Heart")).toBeInTheDocument();
    expect(screen.getByText("1h 1m")).toBeInTheDocument();
  });

  it("calls onSelect once the dispense shake has landed, not before", () => {
    // The card gives one short double-shake (~340ms) before the detail opens,
    // so onSelect is deliberately not synchronous with the click.
    vi.useFakeTimers();
    try {
      const onSelect = vi.fn();
      render(<AudiobookGrid books={[book]} onSelect={onSelect} />);
      fireEvent.click(screen.getByText("The Tell-Tale Heart"));
      expect(onSelect).not.toHaveBeenCalled();
      vi.advanceTimersByTime(340);
      expect(onSelect).toHaveBeenCalledWith(book);
    } finally {
      vi.useRealTimers();
    }
  });
});
