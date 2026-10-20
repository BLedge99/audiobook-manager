import type { Audiobook, Track } from "../types";
import { copy } from "../copy";

/**
 * All listening-position maths, kept out of the components so the GUI redesign
 * (spec 15) restyles the player without reimplementing any of this.
 *
 * Nothing in here touches the DOM, React or the network — every function is a
 * pure transform of (segments, position). The one thing it does read is
 * `copy.ts`, which is itself dependency-free, so the module stays pure.
 */

export type Segment = {
  key: string;
  title?: string;
  duration: number;
  /** Absolute seconds into the whole book where this segment starts. */
  offset: number;
  trackId?: number;
};

/** How the segments of a book were derived. Affects how a position maps in. */
export type SegmentKind = "tracks" | "chapters" | "single";

export function parseChapters(book: Audiobook): { start: number; end: number; title: string }[] {
  if (!book.chapters) return [];
  try {
    const parsed = JSON.parse(book.chapters);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Flatten a book into a list of absolute-offset segments.
 *
 * Three shapes, in the order spec 06 specifies: multi-file track list, then
 * embedded chapters, then the whole file as a single segment. Chapter offsets
 * from ffprobe are absolute file times, so they are used verbatim; track
 * offsets have to be accumulated.
 *
 * A book with exactly one track is still a "tracks" book and streams through
 * the track endpoint — the `> 0` checks are deliberate, not an off-by-one.
 */
export function parseSegments(book: Audiobook): { segments: Segment[]; kind: SegmentKind } {
  const tracks: Track[] = book.tracks.length ? [...book.tracks].sort((a, b) => a.trackNumber - b.trackNumber) : [];
  if (tracks.length > 0) {
    let offset = 0;
    const segments = tracks.map((track) => {
      const segment: Segment = {
        key: String(track.id),
        title: track.title,
        duration: Math.max(0, track.duration || 0),
        offset,
        trackId: track.id,
      };
      offset += segment.duration;
      return segment;
    });
    return { segments, kind: "tracks" };
  }

  const chapters = parseChapters(book);
  if (chapters.length > 0) {
    const segments = chapters
      .map((chapter, index) => {
        const start = Number.isFinite(chapter.start) ? chapter.start : 0;
        // Fall back to the next chapter's start when `end` is missing or the
        // scanner could not determine it. A NaN duration would silently poison
        // every offset after it.
        const next = chapters[index + 1];
        const duration = Number.isFinite(chapter.end) && chapter.end > start
          ? chapter.end - start
          : next && Number.isFinite(next.start) && next.start > start
            ? next.start - start
            : 0;
        return {
          key: String(index),
          title: chapter.title || copy.position.chapterTitle(index + 1),
          duration: Math.max(0, duration),
          offset: start,
        };
      })
      .sort((a, b) => a.offset - b.offset);
    return { segments, kind: "chapters" };
  }

  return {
    segments: [{ key: "full", title: book.title, duration: Math.max(0, book.duration || 0), offset: 0 }],
    kind: "single",
  };
}

/**
 * Total book length. Track durations are the authority when we have them,
 * because a scanned duration can disagree with the sum of its files.
 */
export function totalDuration(book: Audiobook, segments: Segment[]): number {
  const summed = segments.reduce((total, segment) => total + segment.duration, 0);
  if (summed > 0) return summed;
  return Math.max(0, book.duration || 0);
}

/** Coerce anything the audio element or the server might hand us into a usable offset. */
export function safeSeconds(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return value;
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * Which segment contains `position`, and how far into it we are.
 *
 * Boundaries are resolved by range rather than by subtraction, which is what
 * makes this correct for chapter books whose offsets are absolute: a position
 * exactly on a chapter start belongs to that chapter, not the one before it.
 *
 * NaN and negatives mean "the start of the book". +Infinity means "past the
 * end" and clamps to the last segment — snapping it back to zero would
 * contradict `describePosition`, which clamps the same value to the book's end.
 */
export function locateSegment(segments: Segment[], position: number): { index: number; offsetIntoSegment: number } {
  if (segments.length === 0) return { index: -1, offsetIntoSegment: 0 };
  const raw = typeof position === "number" ? position : 0;
  const target = Number.isNaN(raw) ? 0 : Math.max(raw, 0);
  const found = segments.findIndex((segment) => target >= segment.offset && target < segment.offset + segment.duration);
  if (found !== -1) return { index: found, offsetIntoSegment: target - segments[found].offset };

  // Past the end of the last segment, or a book whose durations do not add up.
  const last = segments.length - 1;
  const lastSegment = segments[last];
  if (target >= lastSegment.offset + lastSegment.duration) {
    return { index: last, offsetIntoSegment: lastSegment.duration };
  }
  // Below the first segment's offset (only reachable with malformed data).
  return { index: 0, offsetIntoSegment: 0 };
}

export function percentComplete(position: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return clamp((safeSeconds(position) / total) * 100, 0, 100);
}

/** `h:mm:ss` past an hour, `m:ss` below it. Mirrors the player clock exactly. */
export function timeLabel(seconds: number): string {
  const total = Math.floor(safeSeconds(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

/** Coarse "1h 23m left" / "23m left" — for grids and cards, not the player clock. */
export function remainingLabel(seconds: number): string {
  const total = Math.max(0, Math.ceil(safeSeconds(seconds)));
  if (total < 60) return copy.position.underAMinuteLeft;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (!hours) return copy.position.minutesLeft(minutes);
  return minutes
    ? copy.position.hoursMinutesLeft(hours, minutes)
    : copy.position.hoursLeft(hours);
}

export function chapterHeading(index: number, kind: SegmentKind, total: number): string {
  const noun =
    kind === "chapters" ? copy.position.chapterNoun : kind === "tracks" ? copy.position.trackNoun : copy.position.chapterNoun;
  // A single-segment book has no meaningful chapter number, so don't fake one.
  if (kind === "single" || total <= 1) return noun;
  return copy.position.heading(noun, index + 1);
}

export type PositionDescription = {
  segmentIndex: number;
  segment: Segment | null;
  /** e.g. "Chapter 4" — never a fake number for single-segment books. */
  heading: string;
  title: string;
  offsetIntoSegment: number;
  segmentElapsed: number;
  segmentDuration: number;
  segmentPercent: number;
  bookPosition: number;
  bookTotal: number;
  bookPercent: number;
  bookRemaining: number;
};

/**
 * Everything the readout needs for one playback position, in one call.
 *
 * `bookPosition` is echoed back clamped to the book's length so a stray
 * overshoot from the media element cannot make the UI claim the book is longer
 * than it is.
 */
export function describePosition(
  segments: Segment[],
  position: number,
  kind: SegmentKind = segments.length > 1 ? "tracks" : "single",
  bookTotal?: number,
): PositionDescription {
  const computedTotal = segments.reduce((total, segment) => total + segment.duration, 0);
  const total = bookTotal !== undefined && bookTotal > 0 ? bookTotal : computedTotal;
  const { index, offsetIntoSegment } = locateSegment(segments, position);
  const segment = index >= 0 ? segments[index] : null;
  const segmentDuration = segment?.duration ?? 0;
  const bookPosition = clamp(safeSeconds(position), 0, total || Number.MAX_SAFE_INTEGER);

  return {
    segmentIndex: index,
    segment,
    heading: chapterHeading(index, kind, segments.length),
    title: segment?.title || "",
    offsetIntoSegment,
    segmentElapsed: clamp(offsetIntoSegment, 0, segmentDuration || Number.MAX_SAFE_INTEGER),
    segmentDuration,
    segmentPercent: percentComplete(offsetIntoSegment, segmentDuration),
    bookPosition,
    bookTotal: total,
    bookPercent: percentComplete(bookPosition, total),
    bookRemaining: Math.max(0, total - bookPosition),
  };
}

export type ChapterTick = {
  index: number;
  key: string;
  title: string;
  heading: string;
  /** Fraction of the book, 0..1 — used for CSS positioning. */
  fraction: number;
  offset: number;
};

/**
 * One tick per segment start, as a fraction of the whole book, so the overlay
 * can position them with percentages and never needs to know pixel widths.
 */
export function chapterTicks(segments: Segment[], kind: SegmentKind, bookTotal: number): ChapterTick[] {
  const total = bookTotal > 0 ? bookTotal : segments.reduce((sum, segment) => sum + segment.duration, 0);
  if (!Number.isFinite(total) || total <= 0) return [];
  return segments.map((segment, index) => ({
    index,
    key: segment.key,
    title: segment.title || "",
    heading: chapterHeading(index, kind, segments.length),
    fraction: clamp(segment.offset / total, 0, 1),
    offset: segment.offset,
  }));
}

/**
 * Whether a "you started here" marker is worth drawing.
 *
 * Pointless when the session began at the playhead, when the playhead is still
 * within a few seconds of it (it would sit under the thumb), or when there is
 * no marker at all yet.
 */
export function sessionMarkerFraction(sessionStart: number | null | undefined, currentPosition: number, bookTotal: number): number | null {
  if (sessionStart === null || sessionStart === undefined) return null;
  if (!Number.isFinite(sessionStart) || sessionStart <= 0) return null;
  if (!Number.isFinite(bookTotal) || bookTotal <= 0) return null;
  const current = safeSeconds(currentPosition);
  // Within 10s of the playhead the marker is visually meaningless.
  if (Math.abs(current - sessionStart) < 10) return null;
  return clamp(sessionStart / bookTotal, 0, 1);
}

/** Does this book have a meaningful saved position worth surfacing? */
export function hasProgress(position: number | null | undefined, total: number): boolean {
  const value = safeSeconds(position ?? 0);
  if (value <= 0) return false;
  // Finished books are "done", not "continue listening".
  return !Number.isFinite(total) || total <= 0 || value < total - 1;
}
