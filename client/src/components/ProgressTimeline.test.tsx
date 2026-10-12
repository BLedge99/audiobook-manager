import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProgressTimeline } from "./ProgressTimeline";
import { parseSegments } from "../lib/position";
import type { Audiobook, Track } from "../types";

function book(overrides: Partial<Audiobook> = {}): Audiobook {
  return {
    id: 1,
    title: "A Book",
    author: "An Author",
    duration: 1800,
    fileFormat: "mp3",
    tracks: [],
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const threeTracks: Track[] = [
  { id: 1, trackNumber: 1, duration: 600 },
  { id: 2, trackNumber: 2, duration: 900 },
  { id: 3, trackNumber: 3, duration: 300 },
];

function renderTimeline(overrides: Partial<React.ComponentProps<typeof ProgressTimeline>> = {}) {
  const { segments, kind } = parseSegments(book({ tracks: threeTracks }));
  const props: React.ComponentProps<typeof ProgressTimeline> = {
    segments,
    kind,
    total: 1800,
    value: 0,
    segmentElapsed: 0,
    segmentDuration: 600,
    segmentHeading: "Track 1",
    onSeek: () => undefined,
    ...overrides,
  };
  return { ...render(<ProgressTimeline {...props} />), props };
}

describe("ProgressTimeline", () => {
  it("keeps the native range input as the only labelled control", () => {
    renderTimeline();
    const input = screen.getByLabelText("Audiobook progress");
    expect(input).toHaveAttribute("type", "range");
    expect(input).toHaveAttribute("max", "1800");
  });

  it("draws one tick per segment boundary after the first", () => {
    // The first tick is the track origin, where the bar already starts.
    renderTimeline();
    expect(screen.getAllByTestId("chapter-tick")).toHaveLength(2);
  });

  it("positions ticks at their fraction of the book", () => {
    renderTimeline();
    const ticks = screen.getAllByTestId("chapter-tick");
    expect(ticks[0]).toHaveStyle({ left: `${(600 / 1800) * 100}%` });
    expect(ticks[1]).toHaveStyle({ left: `${(1500 / 1800) * 100}%` });
  });

  it("hides the decoration from assistive tech", () => {
    const { container } = renderTimeline({ sessionStart: 300 });
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0);
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("shows the session marker only when it is meaningfully away from the playhead", () => {
    const { unmount } = renderTimeline({ value: 900, sessionStart: 300 });
    expect(screen.getByTestId("session-marker")).toHaveStyle({ left: `${(300 / 1800) * 100}%` });
    unmount();

    // 5s from the playhead: drawing a marker there would just be noise.
    renderTimeline({ value: 905, sessionStart: 900 });
    expect(screen.queryByTestId("session-marker")).toBeNull();
  });

  it("omits the chapter bar for a single-segment book instead of duplicating the book bar", () => {
    const { segments, kind } = parseSegments(book({ duration: 1800 }));
    render(<ProgressTimeline
      segments={segments}
      kind={kind}
      total={1800}
      value={100}
      segmentElapsed={100}
      segmentDuration={1800}
      segmentHeading="Chapter"
      onSeek={() => undefined}
    />);
    expect(screen.queryByTestId("chapter-bar")).toBeNull();
  });

  it("shows the chapter bar with elapsed and total for a multi-segment book", () => {
    renderTimeline({ value: 750, segmentElapsed: 150, segmentDuration: 900, segmentHeading: "Track 2" });
    const bar = screen.getByTestId("chapter-bar");
    expect(bar).toHaveTextContent("Track 2");
    expect(bar).toHaveTextContent("2:30 / 15:00");
  });

  it("renders the book clock as elapsed, remaining and total", () => {
    const { container } = renderTimeline({ value: 3661, total: 7200 });
    const labels = [...container.querySelectorAll("span")].map((node) => node.textContent);
    expect(labels).toContain("1:01:01");
    // 7200 - 3661 = 3539 = 58:59, which is still under an hour.
    expect(labels).toContain("-58:59");
    expect(labels).toContain("2:00:00");
  });

  it("calls back with the overall position on seek", () => {
    const seen: number[] = [];
    renderTimeline({ onSeek: (position) => seen.push(position) });
    const input = screen.getByLabelText("Audiobook progress") as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setValue?.call(input, "1200");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(seen).toEqual([1200]);
  });
});
