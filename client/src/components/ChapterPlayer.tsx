import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import type { Audiobook } from "../types";
import { copy } from "../copy";
import { ProgressTimeline } from "./ProgressTimeline";
import { Btn, Dome } from "../ui/primitives";
import { remainingLabel, timeLabel } from "../lib/position";
import { usePlayerController, SKIP_SECONDS } from "../lib/playerController";

/**
 * The audiobook player view.
 *
 * ## Architecture
 *
 * Component acts as a thin DOM and visual bridge around the player controller
 * (`client/src/lib/playerController.ts`), preserving ADR 017:
 * "The player's state is the listening position, not the media source."
 *
 * Position state, media resolution, transport actions, persistence, and lock-screen
 * media session integration are owned entirely by the controller module.
 */
export function ChapterPlayer({
  book,
  onProgressSaved,
  localUrlForTrack,
  profileId,
}: {
  book: Audiobook;
  onProgressSaved?: () => void;
  localUrlForTrack?: (bookId: number, trackId: number, serverId?: string) => Promise<string | undefined>;
  profileId?: string | number | null;
}) {
  const {
    audioRef,
    playing,
    playIntent,
    activeProfileId,
    speed,
    sleepMinutes,
    error,
    segments,
    kind,
    total,
    described,
    sessionStart,
    togglePlayback,
    skipSeconds,
    skipSegment,
    selectSegment,
    changeSpeed,
    setSleepTimer,
    goTo,
  } = usePlayerController({
    book,
    onProgressSaved,
    localUrlForTrack,
    profileId,
  });

  const currentIndex = described.segmentIndex;
  const showsPause = playing || playIntent;

  return (
    /* The console. Raspberry-tinted because this is the machine doing one thing
       at a time, and the one surface where the eye should land first. */
    <section
      className="panel mt-8 p-4 sm:p-5"
      aria-label={copy.player.region}
      style={{ background: "color-mix(in srgb, var(--rasp) 7%, var(--surface))" }}
    >
      <audio ref={audioRef} preload="metadata" />

      {/* `flex-wrap` so the transport controls wrap onto a second row on a phone.
          A non-wrapping flex cannot shrink below the sum of its items'
          min-content widths, so four buttons plus two selects forced this row
          to 529px inside a 318px panel -- which overflowed the dialog and made
          the whole player look zoomed in. `min-w-0` on the title block below
          lets the text truncate rather than push the row wider. */}
      <div className="flex flex-wrap items-center gap-3">
        <Dome
          label={showsPause ? copy.player.pause : copy.player.play}
          onClick={() => togglePlayback()}
          spin={playing}
          disabled={!activeProfileId}
        >
          {showsPause ? (
            <Pause size={22} className="fill-white text-white" aria-hidden="true" />
          ) : (
            <Play size={22} className="translate-x-[1px] fill-white text-white" aria-hidden="true" />
          )}
        </Dome>

        <div className="flex items-center gap-2">
          <Btn
            variant="quiet"
            onClick={() => skipSegment(-1)}
            aria-label={copy.player.previousChapter}
            disabled={currentIndex <= 0}
            className="iconbtn"
          >
            <SkipBack size={17} aria-hidden="true" />
          </Btn>
          <Btn
            variant="quiet"
            onClick={() => skipSegment(1)}
            aria-label={copy.player.nextChapter}
            disabled={currentIndex >= segments.length - 1}
            className="iconbtn"
          >
            <SkipForward size={17} aria-hidden="true" />
          </Btn>
          <Btn
            variant="quiet"
            size="sm"
            onClick={() => skipSeconds(-SKIP_SECONDS)}
            aria-label={copy.player.backSeconds(SKIP_SECONDS)}
            className="tnum"
          >
            −{SKIP_SECONDS}s
          </Btn>
          <Btn
            variant="quiet"
            size="sm"
            onClick={() => skipSeconds(SKIP_SECONDS)}
            aria-label={copy.player.forwardSeconds(SKIP_SECONDS)}
            className="tnum"
          >
            +{SKIP_SECONDS}s
          </Btn>
        </div>

        <select
          aria-label={copy.player.speed}
          value={speed}
          onChange={(event) => changeSpeed(Number(event.target.value))}
          className="rounded-[14px_11px_14px_11px/11px_14px_11px_14px] border-2 border-ink/30 bg-surface px-2.5 py-1.5 text-[13px] font-bold text-ink"
        >
          {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3].map((rate) => <option key={rate} value={rate}>{rate}x</option>)}
        </select>
        <select
          aria-label={copy.player.sleepTimer}
          value={sleepMinutes ?? "off"}
          onChange={(event) => setSleepTimer(event.target.value === "off" ? null : Number(event.target.value))}
          className="rounded-[14px_11px_14px_11px/11px_14px_11px_14px] border-2 border-ink/30 bg-surface px-2.5 py-1.5 text-[13px] font-bold text-ink"
        >
          <option value="off">{copy.player.sleepOff}</option>
          <option value="15">{copy.player.sleepMinutes(15)}</option>
          <option value="30">{copy.player.sleepMinutes(30)}</option>
          <option value="60">{copy.player.sleepMinutes(60)}</option>
          <option value="-1">{copy.player.sleepEndOfChapter}</option>
        </select>

        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[15px] font-semibold text-ink">
            {described.title || copy.player.trackFallback(currentIndex + 1)}
          </p>
          <p className="text-[12px] text-ink3 tnum">
            {segments.length > 1 ? `${described.heading} of ${segments.length}` : described.heading}
          </p>
        </div>
      </div>

      {!activeProfileId && (
        <p role="alert" className="panel panel--flat mt-3 px-3 py-2 text-[13px] font-bold text-tan-ink">
          {copy.player.needsProfile}
        </p>
      )}

      {/* Spec 14. Not an aria-live region on purpose: this text changes several
          times a second and announcing each change would make the player
          unusable with a screen reader (decisions/007). */}
      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1" data-testid="position-readout">
        <p className="min-w-0 font-display text-[16px] font-semibold text-ink">
          {described.heading}
          {described.title && <span className="font-normal text-ink2"> — {described.title}</span>}
        </p>
        <p className="text-[12.5px] text-ink3 tnum" data-testid="chapter-readout">
          {timeLabel(described.segmentElapsed)} {copy.player.intoThis(kind === "tracks" ? "track" : "chapter")} · {Math.round(described.segmentPercent)}%
        </p>
        <p className="text-[12.5px] text-ink3 tnum" data-testid="book-readout">
          {Math.round(described.bookPercent)}% of the book · {remainingLabel(described.bookRemaining)}
        </p>
      </div>

      <div className="mt-2.5">
        <ProgressTimeline
          segments={segments}
          kind={kind}
          total={total}
          value={described.bookPosition}
          sessionStart={sessionStart}
          segmentElapsed={described.segmentElapsed}
          segmentDuration={described.segmentDuration}
          segmentHeading={described.heading}
          onSeek={(target) => {
            // Keep whatever the listener was doing: dragging the scrubber while
            // paused must not start playback, and dragging while playing must
            // not stop it.
            goTo(target, { play: playIntent });
          }}
        />
      </div>

      {error && (
        <p role="alert" className="panel panel--flat mt-3 px-3 py-2 text-[13px] font-bold text-rasp-ink">{error}</p>
      )}

      {segments.length > 1 && (
        <ol className="panel panel--sunk mt-4 max-h-52 divide-y divide-ink/10 overflow-auto">
          {segments.map((segment, index) => (
            <li key={segment.key}>
              <button
                type="button"
                onClick={() => selectSegment(index)}
                aria-current={index === currentIndex ? "true" : undefined}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-[13.5px] font-semibold transition ${
                  index === currentIndex ? "bg-rasp text-white" : "text-ink2 hover:bg-ink/5"
                }`}
              >
                <span className="min-w-0 truncate">
                  <span className={`mr-2 tnum ${index === currentIndex ? "text-white/70" : "text-ink3"}`}>{index + 1}.</span>
                  {segment.title || copy.player.trackFallback(index + 1)}
                </span>
                <span className="shrink-0 text-[11.5px] tnum opacity-80">
                  {index === currentIndex ? `${timeLabel(described.segmentElapsed)} / ` : ""}
                  {timeLabel(segment.duration)}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
