import { describe, expect, it } from "vitest";
import {
  chapterTicks,
  describePosition,
  hasProgress,
  locateSegment,
  parseSegments,
  percentComplete,
  remainingLabel,
  sessionMarkerFraction,
  timeLabel,
  totalDuration,
} from "./position";
import type { Audiobook } from "../types";

function book(overrides: Partial<Audiobook> = {}): Audiobook {
  return {
    id: 1,
    title: "A Book",
    author: "An Author",
    duration: 3600,
    fileFormat: "mp3",
    tracks: [],
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const multiTrack = book({
  tracks: [
    { id: 11, trackNumber: 1, duration: 600 },
    { id: 12, trackNumber: 2, duration: 900 },
    { id: 13, trackNumber: 3, duration: 300 },
  ],
});

const chapterBook = book({
  duration: 1800,
  chapters: JSON.stringify([
    { start: 0, end: 700, title: "The Arrival" },
    { start: 700, end: 1400, title: "The Overthrow" },
    { start: 1400, end: 1800, title: "Departures" },
  ]),
});

describe("parseSegments", () => {
  it("accumulates track offsets in track order, not array order", () => {
    const { segments, kind } = parseSegments(book({
      tracks: [
        { id: 2, trackNumber: 2, duration: 300 },
        { id: 1, trackNumber: 1, duration: 600 },
      ],
    }));
    expect(kind).toBe("tracks");
    expect(segments.map((segment) => segment.offset)).toEqual([0, 600]);
  });

  it("treats a single-track book as a track book so it still streams via the track endpoint", () => {
    const { segments, kind } = parseSegments(book({ tracks: [{ id: 9, trackNumber: 1, duration: 120 }] }));
    expect(kind).toBe("tracks");
    expect(segments).toHaveLength(1);
    expect(segments[0].trackId).toBe(9);
  });

  it("uses chapter offsets verbatim instead of accumulating durations", () => {
    const { segments, kind } = parseSegments(chapterBook);
    expect(kind).toBe("chapters");
    expect(segments.map((segment) => segment.offset)).toEqual([0, 700, 1400]);
    expect(segments.map((segment) => segment.duration)).toEqual([700, 700, 400]);
  });

  it("falls back to the next chapter's start when a chapter has no usable end", () => {
    const { segments } = parseSegments(book({
      duration: 1000,
      chapters: JSON.stringify([
        { start: 0, title: "One" },
        { start: 400, end: 1000, title: "Two" },
      ]),
    }));
    expect(segments.map((segment) => segment.duration)).toEqual([400, 600]);
  });

  it("never produces a NaN duration, which would poison every later offset", () => {
    const { segments } = parseSegments(book({
      duration: 1000,
      chapters: JSON.stringify([
        { start: 0, end: "not a number", title: "One" },
        { start: 300, end: 900, title: "Two" },
      ]),
    }));
    for (const segment of segments) {
      expect(Number.isFinite(segment.duration)).toBe(true);
      expect(Number.isFinite(segment.offset)).toBe(true);
    }
  });

  it("falls back to one whole-book segment when there are no tracks or chapters", () => {
    const { segments, kind } = parseSegments(book({ duration: 1234 }));
    expect(kind).toBe("single");
    expect(segments).toHaveLength(1);
    expect(segments[0].duration).toBe(1234);
  });

  it("survives unparseable chapter JSON rather than throwing", () => {
    const { segments, kind } = parseSegments(book({ chapters: "{not json" }));
    expect(kind).toBe("single");
    expect(segments).toHaveLength(1);
  });
});

describe("locateSegment", () => {
  const { segments } = parseSegments(chapterBook);

  it("maps the start of a chapter to that chapter, not the one before it", () => {
    // The classic boundary bug: subtracting durations makes 700 land ambiguously.
    expect(locateSegment(segments, 700).index).toBe(1);
    expect(locateSegment(segments, 700).offsetIntoSegment).toBe(0);
    expect(locateSegment(segments, 1400).index).toBe(2);
  });

  it("handles position zero and the last second of a chapter", () => {
    expect(locateSegment(segments, 0).index).toBe(0);
    const lastSecond = locateSegment(segments, 1399);
    expect(lastSecond.index).toBe(1);
    expect(lastSecond.offsetIntoSegment).toBe(699);
  });

  it("clamps a position past the end of the book to the last chapter", () => {
    const past = locateSegment(segments, 99_999);
    expect(past.index).toBe(2);
    expect(past.offsetIntoSegment).toBe(400);
  });

  it("treats negative and NaN positions as the start", () => {
    expect(locateSegment(segments, -50).index).toBe(0);
    expect(locateSegment(segments, Number.NaN).index).toBe(0);
    expect(locateSegment(segments, Number.POSITIVE_INFINITY).index).toBe(2);
  });

  it("returns a sentinel for an empty segment list instead of throwing", () => {
    expect(locateSegment([], 10).index).toBe(-1);
  });

  it("resolves track books by accumulated offset", () => {
    const tracks = parseSegments(multiTrack).segments;
    expect(locateSegment(tracks, 599).index).toBe(0);
    expect(locateSegment(tracks, 600).index).toBe(1);
    expect(locateSegment(tracks, 1499).index).toBe(1);
    expect(locateSegment(tracks, 1500).index).toBe(2);
  });
});

describe("describePosition", () => {
  const { segments, kind } = parseSegments(chapterBook);

  it("reports the chapter the position actually falls in, at minute scale", () => {
    // The listener's own example: "Chapter 4, 45:34". Needs chapters long
    // enough to contain 45 minutes, hence a separate fixture.
    const long = parseSegments(book({
      duration: 12000,
      chapters: JSON.stringify([
        { start: 0, end: 1200, title: "One" },
        { start: 1200, end: 5000, title: "Two" },
        { start: 5000, end: 7000, title: "Three" },
        { start: 7000, end: 12000, title: "Four" },
      ]),
    }));
    const described = describePosition(long.segments, 7000 + 45 * 60 + 34, long.kind, 12000);
    expect(described.heading).toBe("Chapter 4");
    expect(described.title).toBe("Four");
    expect(described.segmentElapsed).toBe(45 * 60 + 34);
    expect(described.bookPercent).toBeCloseTo(((7000 + 2734) / 12000) * 100, 5);
    expect(described.bookRemaining).toBe(12000 - (7000 + 2734));
  });

  it("does not claim a chapter number for a single-segment book", () => {
    const single = parseSegments(book({ duration: 600 }));
    expect(describePosition(single.segments, 100, single.kind, 600).heading).toBe("Chapter");
    expect(describePosition(single.segments, 100, single.kind, 600).bookRemaining).toBe(500);
  });

  it("uses Track as the noun for a multi-file book", () => {
    const tracks = parseSegments(multiTrack);
    expect(describePosition(tracks.segments, 700, tracks.kind, 1800).heading).toBe("Track 2");
  });

  it("clamps an overshooting position to the book's real length", () => {
    const described = describePosition(segments, 5000, kind, 1800);
    expect(described.bookPosition).toBe(1800);
    expect(described.bookPercent).toBe(100);
    expect(described.bookRemaining).toBe(0);
  });

  it("falls back to the summed segment length when no total is given", () => {
    expect(describePosition(segments, 0, kind).bookTotal).toBe(1800);
  });

  it("survives a missing duration without producing NaN percentages", () => {
    const described = describePosition(segments, 100, kind, 0);
    expect(Number.isNaN(described.bookPercent)).toBe(false);
    expect(described.segmentPercent).toBeCloseTo((100 / 700) * 100, 5);
  });
});

describe("chapterTicks", () => {
  it("emits one tick per segment at its fraction of the book", () => {
    const { segments, kind } = parseSegments(chapterBook);
    const ticks = chapterTicks(segments, kind, 1800);
    expect(ticks).toHaveLength(3);
    expect(ticks.map((tick) => tick.fraction)).toEqual([0, 700 / 1800, 1400 / 1800]);
    expect(ticks[1].heading).toBe("Chapter 2");
    expect(ticks[1].title).toBe("The Overthrow");
  });

  it("returns nothing when the book has no usable duration", () => {
    const { segments, kind } = parseSegments(book({ duration: 0 }));
    expect(chapterTicks(segments, kind, 0)).toEqual([]);
  });

  it("never places a tick outside the bar", () => {
    const { segments, kind } = parseSegments(book({
      duration: 5000,
      tracks: [{ id: 1, trackNumber: 1, duration: 400 }, { id: 2, trackNumber: 2, duration: 400 }],
    }));
    // Book duration disagrees with the summed track durations.
    for (const tick of chapterTicks(segments, kind, 5000)) {
      expect(tick.fraction).toBeGreaterThanOrEqual(0);
      expect(tick.fraction).toBeLessThanOrEqual(1);
    }
  });
});

describe("sessionMarkerFraction", () => {
  it("places the marker at the session start", () => {
    expect(sessionMarkerFraction(600, 900, 1800)).toBeCloseTo(1 / 3, 5);
  });

  it("hides the marker when it would sit under the playhead", () => {
    expect(sessionMarkerFraction(900, 905, 1800)).toBeNull();
  });

  it("hides the marker when there is no session, or it started at zero", () => {
    expect(sessionMarkerFraction(null, 900, 1800)).toBeNull();
    expect(sessionMarkerFraction(0, 900, 1800)).toBeNull();
    expect(sessionMarkerFraction(undefined, 900, 1800)).toBeNull();
  });

  it("hides the marker for a zero-length or unplayable book", () => {
    expect(sessionMarkerFraction(100, 900, 0)).toBeNull();
  });
});

describe("hasProgress", () => {
  it("is true for a part-finished book", () => {
    expect(hasProgress(500, 3600)).toBe(true);
  });

  it("is false for an unstarted, finished or unknown book", () => {
    expect(hasProgress(0, 3600)).toBe(false);
    expect(hasProgress(null, 3600)).toBe(false);
    expect(hasProgress(3599.5, 3600)).toBe(false);
    // Unknown duration cannot prove the book is finished, so keep it resumable.
    expect(hasProgress(500, 0)).toBe(true);
  });
});

describe("labels", () => {
  it("formats time with hours only when needed", () => {
    expect(timeLabel(0)).toBe("0:00");
    expect(timeLabel(9)).toBe("0:09");
    expect(timeLabel(65)).toBe("1:05");
    expect(timeLabel(3600)).toBe("1:00:00");
    expect(timeLabel(45296)).toBe("12:34:56");
  });

  it("never renders a negative or NaN clock", () => {
    expect(timeLabel(-10)).toBe("0:00");
    expect(timeLabel(Number.NaN)).toBe("0:00");
  });

  it("summarises remaining time coarsely", () => {
    expect(remainingLabel(30)).toBe("under a minute left");
    expect(remainingLabel(45 * 60)).toBe("45m left");
    expect(remainingLabel(60 * 60)).toBe("1h left");
    expect(remainingLabel(60 * 60 + 25 * 60)).toBe("1h 25m left");
    expect(remainingLabel(0)).toBe("under a minute left");
  });

  it("clamps percentages to 0..100 and survives a zero total", () => {
    expect(percentComplete(500, 1000)).toBe(50);
    expect(percentComplete(5000, 1000)).toBe(100);
    expect(percentComplete(-5, 1000)).toBe(0);
    expect(percentComplete(5, 0)).toBe(0);
  });
});

describe("totalDuration", () => {
  it("prefers the summed segment lengths over the scanned book duration", () => {
    const { segments } = parseSegments(multiTrack);
    // Multi-file book: 600 + 900 + 300.
    expect(totalDuration(multiTrack, segments)).toBe(1800);
  });

  it("falls back to the book duration when segments carry no length", () => {
    expect(totalDuration(book({ duration: 999 }), [])).toBe(999);
  });
});
