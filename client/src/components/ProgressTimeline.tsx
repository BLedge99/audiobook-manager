import type { Segment, SegmentKind } from "../lib/position";
import { chapterTicks, sessionMarkerFraction, timeLabel } from "../lib/position";

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
 * No position logic lives here — it is all supplied by `lib/position`.
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
            is hidden from assistive tech — see decisions/007. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/2 z-10 h-2 -translate-y-1/2">
          {ticks.slice(1).map((tick) => (
            <span
              key={tick.key}
              data-testid="chapter-tick"
              className="absolute top-0 h-2 w-px bg-white/50"
              style={{ left: `${tick.fraction * 100}%` }}
            />
          ))}
          {marker !== null && (
            <span
              data-testid="session-marker"
              className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/70 ring-1 ring-slate-900/60"
              style={{ left: `${marker * 100}%` }}
            />
          )}
        </div>
        <input
          aria-label="Audiobook progress"
          type="range"
          min={0}
          max={total || 1}
          step={1}
          disabled={disabled}
          value={Math.min(value, total || 1)}
          onChange={(event) => onSeek(Number(event.target.value))}
          className="relative w-full accent-cyan-400 disabled:opacity-40"
        />
      </div>

      <div className="mt-1 flex justify-between text-xs text-slate-400">
        <span>{timeLabel(value)}</span>
        <span>-{timeLabel(Math.max(0, total - value))}</span>
        <span>{timeLabel(total)}</span>
      </div>

      {showChapterBar && (
        <div className="mt-2" data-testid="chapter-bar">
          <div className="flex justify-between text-xs text-slate-400">
            <span>{segmentHeading}</span>
            <span>{`${timeLabel(segmentElapsed)} / ${timeLabel(segmentDuration)}`}</span>
          </div>
          <div aria-hidden="true" className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-800">
            <div className="h-full bg-cyan-400/70" style={{ width: `${chapterFill}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}
