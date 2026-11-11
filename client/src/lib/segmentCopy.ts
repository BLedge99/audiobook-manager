/**
 * Render the data `lib/position` returns as words.
 *
 * `position.ts` is deliberately dependency-free and returns data; this module
 * is the seam where that data becomes the listener's copy.
 */
import { copy } from "../copy";
import { remainingTime, type SegmentHeading } from "./position";

/** "Chapter 4" / "Track 2" / the bare noun for single-segment books. */
export function headingText(heading: SegmentHeading): string {
  const noun = heading.kind === "tracks" ? copy.position.trackNoun : copy.position.chapterNoun;
  // A number would be a lie for a single-segment book.
  return heading.number === null ? noun : copy.position.heading(noun, heading.number);
}

/** "under a minute left" / "45m left" / "1h 25m left" / "2h left". */
export function remainingLabel(seconds: number): string {
  const time = remainingTime(seconds);
  if (time.subMinute) return copy.position.underAMinuteLeft;
  if (time.hours > 0) {
    return time.minutes > 0
      ? copy.position.hoursMinutesLeft(time.hours, time.minutes)
      : copy.position.hoursLeft(time.hours);
  }
  return copy.position.minutesLeft(time.minutes);
}
