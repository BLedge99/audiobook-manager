import type { Segment, SegmentKind } from "../lib/position";
import { chapterTicks, sessionMarkerFraction, timeLabel } from "../lib/position";
import { copy } from "../copy";

/**
 * The seek control: a native range input with chapter ticks, a session-start
 * marker and a secondary chapter-progress bar drawn as inert decoration.
 *
 * Per decisions/007 the range input stays the only interactive element, so
 * keyboard and screen-reader behaviour is inherited rather than reimplemented.
 * Everything visual is `aria-hidden` and `pointer-events-none`; the same
 * information is available as text in the readout above the control and in the
 * chapter list, so nothing is lost by hiding it from assistive tech.
 *
 * No position logic lives here -- it is all supplied by `lib/position`.
 */
export type ProgressTimelineProps = {
  segments: Segment[];
  kind: SegmentKind;
  total: number;
  /** Overall position in the book, in seconds. */
  value: number;
  /** Overall position the current listening session began at, if known. */
  sessionStart?: number | null;
  /** Elapsed seconds within the current chapter. */
  segmentElapsed: number;
  /** Duration of the current chapter. */
  segmentDuration: number;
  segmentHeading: string;
  onSeek: (overallPosition: number) => void;
  disabled?: boolean;
};

export function ProgressTimeline({
  segments,
  kind,
  total,
  value,
  sessionStart,
  segmentElapsed,
  segmentDuration,
  segmentHeading,
  onSeek,
  disabled,
}: ProgressTimelineProps) {
  const ticks = chapterTicks(segments, kind, total);
  const marker = sessionMarkerFraction(sessionStart, value, total);
  // A single-segment book would render a chapter bar identical to the book bar.
  const showChapterBar = segments.length > 1 && segmentDuration > 0;
  const chapterFill = segmentDuration > 0 ? Math.min(Math.max((segmentElapsed / segmentDuration) * 100, 0), 100) : 0;

  return (
    <div>
      <div className="relative">
        {/* Decoration only. Sits above the track, ignores all pointer events, and
            is hidden from assistive tech -- see decisions/007. Aligned to the
            thumb's travel (15px inset either side), not the raw input width. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-[15px] top-1/2 z-10 -translate-y-1/2">
          {ticks.slice(1).map((tick) => (
            <span
              key={tick.key}
              data-testid="chapter-tick"
              className="absolute top-0 h-2.5 w-[2px] -translate-x-1/2 rounded-full bg-ink/45"
              style={{ left: `${tick.fraction * 100}%` }}
            />
          ))}
          {marker !== null && (
            <span
              data-testid="session-marker"
              className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink bg-tan"
              style={{ left: `${marker * 100}%` }}
            />
          )}
        </div>
        <input
          aria-label={copy.player.progressRegion}
          type="range"
          min={0}
          max={total || 1}
          step={1}
          disabled={disabled}
          value={Math.min(value, total || 1)}
          onChange={(event) => onSeek(Number(event.target.value))}
          className="scrubber relative"
        />
      </div>

      <div className="mt-0.5 flex justify-between text-[12.5px] font-bold text-ink3 tnum">
        <span>{timeLabel(value)}</span>
        <span>-{timeLabel(Math.max(0, total - value))}</span>
        <span>{timeLabel(total)}</span>
      </div>

      {showChapterBar && (
        <div className="mt-2.5" data-testid="chapter-bar">
          <div className="flex justify-between gap-3 text-[12.5px] font-semibold text-ink2">
            <span className="min-w-0 truncate">{segmentHeading}</span>
            <span className="shrink-0 tnum">{`${timeLabel(segmentElapsed)} / ${timeLabel(segmentDuration)}`}</span>
          </div>
          <div aria-hidden="true" className="tube mt-1.5">
            <i style={{ width: `${chapterFill}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}