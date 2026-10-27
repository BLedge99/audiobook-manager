import type { Audiobook } from "../types";
import { clamp, locateSegment, safeSeconds, totalDuration as computeTotalDuration, type Segment, type SegmentKind } from "./position";

/**
 * How a book's listening position maps onto the media that actually plays.
 *
 * ## Why this module exists
 *
 * The player used to treat **the loaded media source** as its state: a track
 * changed, so the source URL changed, so the `src` effect reloaded the element
 * and playback carried on. That works for a book of many files and cannot work
 * for a book of one file with embedded chapters, because all seventy chapters
 * share one URL: nothing changes when a chapter ends, so nothing happens.
 *
 * Every attempt to bolt chapter playback onto that model added another special
 * case (`selectSegment` seeks directly, `onEnded` seeks and plays, a pending
 * seek survives a reload...), and each one broke the other kind of book. The
 * `onEnded` chapter fix was in fact unreachable: for a one-file book `ended`
 * fires at the end of the *file*, by which time the position is already in the
 * last chapter.
 *
 * So the state is now **the listening position**, and the source is derived
 * from it. Two different books are then the same two lines of maths:
 *
 * | Book              | Segments          | Source            | Time in source |
 * |-------------------|-------------------|-------------------|----------------|
 * | one file, chapters| each chapter      | the book's stream | chapter offset |
 * | many files        | each track        | that track stream | 0 (+ offset)   |
 * | one file, no data | the whole book    | the book's stream | 0              |
 *
 * Nothing here touches the DOM, React or the network. The player applies the
 * plan; the plan never learns about the player.
 */

/** Which route serves the media: the whole book, or one track of it. */
export type SourceKind = "book" | "track";

export type PlaybackSource = {
  /**
   * Stable identity for the media, and the thing the player compares to decide
   * whether to reload the element. Deliberately *not* the URL: a native stream
   * URL carries a short-lived media token and changes on every refresh, and
   * reloading a file because its token was renewed is how you lose a seek.
   */
  key: string;
  /** API path, before the shell resolves it to a fetchable URL. */
  path: string;
  kind: SourceKind;
  /** Media-item id for a book source, track id for a track source. */
  id: number;
  /**
   * The track whose *file* backs this source, when one is known.
   *
   * A chapter book streams the whole book, and the book's file is its single
   * track. That id is what makes a downloaded M4B play from the device instead
   * of streaming a file it already has.
   */
  localTrackId?: number;
};

/**
 * The source a segment plays from, plus where in that source it starts.
 *
 * `base` is the book position at which the source begins: 0 for a whole-book
 * source (chapter offsets are absolute file times), the segment's offset for a
 * per-track source. `sourceTime` is therefore always:
 *
 *     sourceTime = position - base
 *
 * which is the one equation the player needs.
 */
export type SourcePlan = {
  /** Index of the segment that contains `position`. */
  index: number;
  segment: Segment | null;
  source: PlaybackSource;
  /** Book seconds at which this source starts. */
  base: number;
  /** Seconds into the source. */
  sourceTime: number;
  /** The requested position, clamped to the book. */
  position: number;
};

/** A book source is the fallback for anything the data cannot describe. */
function bookSource(book: Audiobook, tracks: { id: number }[]): PlaybackSource {
  return {
    key: `book:${book.id}`,
    path: `/api/audiobooks/${book.id}/stream`,
    kind: "book",
    id: book.id,
    localTrackId: tracks[0]?.id,
  };
}

/** Tracks in playback order, matching `parseSegments`. */
export function orderedTracks(book: Audiobook): { id: number; trackNumber: number; duration: number }[] {
  return book.tracks.length ? [...book.tracks].sort((a, b) => a.trackNumber - b.trackNumber) : [];
}

/**
 * Which media a segment plays from.
 *
 * A chapter (or a whole-book) source always streams the book's single file; a
 * track source streams that one file. Chapters only ever exist on a one-file
 * book -- the scanner records them only for a single file, and `parseSegments`
 * refuses them when there is more than one -- so "the book stream" and "the
 * book's only file" are the same thing.
 */
export function sourceForSegment(book: Audiobook, kind: SegmentKind, segment: Segment | null): PlaybackSource {
  const tracks = orderedTracks(book);
  if (kind === "tracks" && segment?.trackId !== undefined) {
    return {
      key: `track:${segment.trackId}`,
      path: `/api/tracks/${segment.trackId}/stream`,
      kind: "track",
      id: segment.trackId,
      localTrackId: segment.trackId,
    };
  }
  return bookSource(book, tracks);
}

function planFrom(
  book: Audiobook,
  segments: Segment[],
  kind: SegmentKind,
  index: number,
  position: number,
): SourcePlan {
  const segment = index >= 0 && index < segments.length ? segments[index] : null;
  const source = sourceForSegment(book, kind, segment);
  // A whole-book source starts at 0 even though the segment inside it (a
  // chapter) starts later, because the chapter's offset is already a time in
  // that file. Only a per-track source shifts the book position by its offset.
  const base = source.kind === "track" ? segment?.offset ?? 0 : 0;
  return {
    index,
    segment,
    source,
    base,
    sourceTime: Math.max(0, position - base),
    position,
  };
}

/**
 * The plan for an arbitrary book position.
 *
 * `+Infinity` and past-the-end positions clamp to the last segment, matching
 * `describePosition`, so the UI never disagrees with the element.
 */
export function planPosition(book: Audiobook, segments: Segment[], kind: SegmentKind, position: number): SourcePlan {
  const total = computeTotalDuration(book, segments);
  const target = clamp(safeSeconds(position), 0, total || Number.MAX_SAFE_INTEGER);
  const { index } = locateSegment(segments, target);
  return planFrom(book, segments, kind, index, target);
}

/**
 * The plan for the *start of a segment*, addressed by index.
 *
 * Separate from `planPosition` because a zero-length segment can never be
 * located by position, and the chapter list must still be able to jump to it.
 */
export function planSegment(book: Audiobook, segments: Segment[], kind: SegmentKind, index: number): SourcePlan {
  if (segments.length === 0) return planFrom(book, segments, kind, -1, 0);
  const clamped = clamp(index, 0, segments.length - 1);
  return planFrom(book, segments, kind, clamped, segments[clamped].offset);
}

/** Where the book position is, given the loaded source and its clock. */
export function bookPositionFromSource(base: number, sourceTime: number): number {
  return safeSeconds(base) + safeSeconds(sourceTime);
}

/** The segment after `index`, or null at the end of the book. */
export function nextSegmentIndex(segments: Segment[], index: number): number | null {
  const next = index + 1;
  return next >= 0 && next < segments.length ? next : null;
}

/** The segment before `index`, or null at the start of the book. */
export function previousSegmentIndex(segments: Segment[], index: number): number | null {
  const previous = index - 1;
  return previous >= 0 && previous < segments.length ? previous : null;
}

/** The last second of a segment, for the "end of chapter" sleep timer. */
export function segmentEnd(segment: Segment | null): number {
  if (!segment) return 0;
  return segment.offset + Math.max(0, segment.duration);
}

/**
 * Did `position` cross the end of the segment that was playing?
 *
 * Used by the sleep timer. A chapter book plays straight through a chapter
 * boundary -- that is what "seamless" means -- so the boundary has to be
 * detected from the position, not from an `ended` event that only ever fires
 * at the end of the file.
 */
export function reachedSegmentEnd(segment: Segment | null, position: number, tolerance = 0.05): boolean {
  if (!segment || segment.duration <= 0) return false;
  return position >= segmentEnd(segment) - tolerance;
}
