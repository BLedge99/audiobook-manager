/**
 * Pure listening-progress mathematics for the audiobook server.
 *
 * Extracted from the progress route handlers so the clamp, completion and
 * session-bound rules have a single interface that unit tests can hit without
 * going through HTTP plus a database.
 */

/** A book counts as completed once the listener reaches this fraction of it. */
export const COMPLETION_RATIO = 0.95;

/** Upper bound for a persisted playback speed. */
export const MAX_PLAYBACK_SPEED = 10;

/**
 * Clamp a raw position into the book's real bounds when the duration is known.
 * A non-finite or negative value resets to the start rather than persisting
 * garbage that would resume a book at an impossible offset. When no usable
 * duration exists the raw position is clamped to zero.
 */
export function clampPosition(rawPosition: number, duration: number): number {
  const safeRaw = Number.isFinite(rawPosition) ? rawPosition : 0;
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  if (safeDuration > 0) {
    return Math.min(Math.max(safeRaw, 0), safeDuration);
  }
  return Math.max(0, safeRaw);
}

/**
 * Resolve the completed flag: an explicit value wins; otherwise the book is
 * completed once the (clamped) position reaches `COMPLETION_RATIO` of the
 * duration.
 */
export function resolveCompleted(position: number, duration: number, completed?: boolean): boolean {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  if (completed !== undefined) return completed;
  return safeDuration > 0 && position >= COMPLETION_RATIO * safeDuration;
}

/**
 * Normalize a listening session's positions against the book's duration: no
 * negative offsets, and no position past the end of the book.
 */
export function normalizeSessionBounds(toPosition: number, fromPosition: number, duration: number): { from: number; to: number } {
  const safeTo = Math.min(Math.max(toPosition, 0), duration || toPosition);
  const safeFrom = Math.min(Math.max(fromPosition, 0), safeTo);
  return { from: safeFrom, to: safeTo };
}

/**
 * Normalize a session's playback speed: finite, positive, capped at
 * `MAX_PLAYBACK_SPEED`; anything else falls back to normal speed.
 */
export function normalizeSessionSpeed(speed: number): number {
  const safeSpeed = Number.isFinite(speed) && speed > 0 ? Math.min(speed, MAX_PLAYBACK_SPEED) : 1;
  return safeSpeed;
}
