import { describe, expect, it } from "vitest";
import type { Audiobook } from "../types";
import { parseSegments } from "./position";
import {
  bookPositionFromSource,
  nextSegmentIndex,
  planPosition,
  planSegment,
  previousSegmentIndex,
  reachedSegmentEnd,
  segmentEnd,
  sourceForSegment,
  orderedTracks,
} from "./playback";

function book(overrides: Partial<Audiobook> = {}): Audiobook {
  return {
    id: 7,
    title: "Test Book",
    author: "Author",
    duration: 900,
    fileFormat: "mp3",
    tracks: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/** One file with embedded chapters -- the shape that broke the old player. */
const chapterBook = book({
  duration: 900,
  tracks: [{ id: 41, trackNumber: 1, duration: 900 }],
  chapters: JSON.stringify([
    { start: 0, end: 300, title: "One" },
    { start: 300, end: 600, title: "Two" },
    { start: 600, end: 900, title: "Three" },
  ]),
});

/** Many files, no chapters -- the shape the old player was built for. */
const trackBook = book({
  duration: 2375,
  tracks: [
    { id: 11, trackNumber: 1, duration: 830 },
    { id: 12, trackNumber: 2, duration: 1545 },
  ],
});

const segmentsOf = (value: Audiobook) => {
  const { segments, kind } = parseSegments(value);
  return { segments, kind };
};

describe("sourceForSegment", () => {
  it("streams the book's single file for every chapter of a chapter book", () => {
    const { segments, kind } = segmentsOf(chapterBook);
    const sources = segments.map((segment) => sourceForSegment(chapterBook, kind, segment));
    expect(sources.map((source) => source.key)).toEqual(["book:7", "book:7", "book:7"]);
    expect(sources[0].path).toBe("/api/audiobooks/7/stream");
    // The book's file is its one track, which is what makes a downloaded M4B
    // playable from the device.
    expect(sources[0].localTrackId).toBe(41);
  });

  it("streams one file per segment when the book is a set of tracks", () => {
    const { segments, kind } = segmentsOf(trackBook);
    const sources = segments.map((segment) => sourceForSegment(trackBook, kind, segment));
    expect(sources.map((source) => source.key)).toEqual(["track:11", "track:12"]);
    expect(sources[1].path).toBe("/api/tracks/12/stream");
    expect(sources[1].localTrackId).toBe(12);
  });

  it("falls back to the book stream when a track segment has no id", () => {
    const source = sourceForSegment(trackBook, "tracks", { key: "x", duration: 10, offset: 0 });
    expect(source.key).toBe("book:7");
    expect(source.localTrackId).toBe(11);
  });

  it("orders tracks by track number, not by array order", () => {
    const shuffled = book({
      tracks: [
        { id: 2, trackNumber: 2, duration: 10 },
        { id: 1, trackNumber: 1, duration: 10 },
      ],
    });
    expect(orderedTracks(shuffled).map((track) => track.id)).toEqual([1, 2]);
  });
});

describe("planPosition", () => {
  it("keeps a chapter's absolute offset as the time in the one file", () => {
    const { segments, kind } = segmentsOf(chapterBook);
    const plan = planPosition(chapterBook, segments, kind, 350);
    expect(plan.index).toBe(1);
    expect(plan.base).toBe(0);
    expect(plan.sourceTime).toBe(350);
    expect(plan.position).toBe(350);
    expect(plan.source.key).toBe("book:7");
  });

  it("subtracts the track offset for a book of tracks", () => {
    const { segments, kind } = segmentsOf(trackBook);
    const plan = planPosition(trackBook, segments, kind, 900);
    expect(plan.index).toBe(1);
    expect(plan.base).toBe(830);
    expect(plan.sourceTime).toBe(70);
    expect(plan.source.key).toBe("track:12");
  });

  it("lands exactly on a boundary in the segment that starts there", () => {
    const { segments, kind } = segmentsOf(chapterBook);
    expect(planPosition(chapterBook, segments, kind, 300).index).toBe(1);
    expect(planPosition(chapterBook, segments, kind, 600).index).toBe(2);
  });

  it("clamps a negative or nonsense position to the start", () => {
    const { segments, kind } = segmentsOf(chapterBook);
    for (const value of [-5, Number.NaN]) {
      const plan = planPosition(chapterBook, segments, kind, value);
      expect(plan.position).toBe(0);
      expect(plan.sourceTime).toBe(0);
      expect(plan.index).toBe(0);
    }
  });

  it("clamps a position past the end to the last segment, not the first", () => {
    const { segments, kind } = segmentsOf(chapterBook);
    const plan = planPosition(chapterBook, segments, kind, 100_000);
    expect(plan.index).toBe(2);
    expect(plan.position).toBe(900);
    // The element must never be asked to seek past the file.
    expect(plan.sourceTime).toBeLessThanOrEqual(900);
  });

  it("treats a book with no tracks and no chapters as one whole-book segment", () => {
    const { segments, kind } = segmentsOf(book({ duration: 1234 }));
    const plan = planPosition(book({ duration: 1234 }), segments, kind, 12);
    expect(plan.source.key).toBe("book:7");
    expect(plan.base).toBe(0);
    expect(plan.sourceTime).toBe(12);
  });
});

describe("planSegment", () => {
  it("addresses a segment by index even when it has no duration", () => {
    const zero = book({
      duration: 100,
      tracks: [{ id: 5, trackNumber: 1, duration: 100 }],
      chapters: JSON.stringify([
        { start: 0, end: 100, title: "Real" },
        { start: 100, end: 100, title: "Empty" },
      ]),
    });
    const { segments, kind } = segmentsOf(zero);
    const plan = planSegment(zero, segments, kind, 1);
    expect(plan.index).toBe(1);
    expect(plan.sourceTime).toBe(100);
  });

  it("clamps an out-of-range index", () => {
    const { segments, kind } = segmentsOf(chapterBook);
    expect(planSegment(chapterBook, segments, kind, 99).index).toBe(2);
    expect(planSegment(chapterBook, segments, kind, -3).index).toBe(0);
  });

  it("survives an empty segment list", () => {
    const plan = planSegment(chapterBook, [], "single", 3);
    expect(plan.index).toBe(-1);
    expect(plan.segment).toBeNull();
    expect(plan.source.key).toBe("book:7");
  });

  it("starts a track segment at the beginning of its file", () => {
    const { segments, kind } = segmentsOf(trackBook);
    const plan = planSegment(trackBook, segments, kind, 1);
    expect(plan.source.key).toBe("track:12");
    expect(plan.sourceTime).toBe(0);
    expect(plan.base).toBe(830);
    expect(plan.position).toBe(830);
  });
});

describe("bookPositionFromSource", () => {
  it("adds the source's base offset back on", () => {
    expect(bookPositionFromSource(830, 70)).toBe(900);
    expect(bookPositionFromSource(0, 42)).toBe(42);
  });

  it("refuses nonsense from the media element", () => {
    expect(bookPositionFromSource(830, Number.NaN)).toBe(830);
    expect(bookPositionFromSource(830, -10)).toBe(830);
  });
});

describe("segment neighbours", () => {
  it("walks a chapter book forwards and stops at the end", () => {
    const { segments } = segmentsOf(chapterBook);
    expect(nextSegmentIndex(segments, 0)).toBe(1);
    expect(nextSegmentIndex(segments, 2)).toBeNull();
  });

  it("walks back and stops at the start", () => {
    const { segments } = segmentsOf(chapterBook);
    expect(previousSegmentIndex(segments, 2)).toBe(1);
    expect(previousSegmentIndex(segments, 0)).toBeNull();
  });
});

describe("segmentEnd and reachedSegmentEnd", () => {
  it("is the offset plus the duration", () => {
    const { segments } = segmentsOf(chapterBook);
    expect(segmentEnd(segments[1])).toBe(600);
  });

  it("reports the boundary for a chapter book, which has no `ended` event", () => {
    const { segments } = segmentsOf(chapterBook);
    expect(reachedSegmentEnd(segments[0], 299.5)).toBe(false);
    expect(reachedSegmentEnd(segments[0], 299.98)).toBe(true);
    expect(reachedSegmentEnd(segments[0], 305)).toBe(true);
  });

  it("never reports an end for a segment with no duration", () => {
    expect(reachedSegmentEnd({ key: "x", duration: 0, offset: 100 }, 1000)).toBe(false);
    expect(reachedSegmentEnd(null, 1000)).toBe(false);
  });
});

/**
 * The invariant the whole player rests on: every book position has exactly one
 * source and one time in it, and mapping the time back gives the position
 * again. If this ever fails, a seek or an advance lands somewhere else.
 */
describe("position round-trip", () => {
  for (const [name, value] of [["chapter book", chapterBook], ["track book", trackBook]] as const) {
    it(`survives a round trip across the whole of a ${name}`, () => {
      const { segments, kind } = segmentsOf(value);
      for (let position = 0; position <= value.duration; position += 7) {
        const plan = planPosition(value, segments, kind, position);
        expect(bookPositionFromSource(plan.base, plan.sourceTime)).toBeCloseTo(position, 5);
      }
    });
  }

  it("never asks for a time past the end of the file it is playing", () => {
    const { segments, kind } = segmentsOf(trackBook);
    for (let position = 0; position <= trackBook.duration; position += 11) {
      const plan = planPosition(trackBook, segments, kind, position);
      const segment = segments[plan.index];
      expect(plan.sourceTime).toBeLessThanOrEqual(Math.max(segment.duration, 0) + 0.001);
    }
  });
});
