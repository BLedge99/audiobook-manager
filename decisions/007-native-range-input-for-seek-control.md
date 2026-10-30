# 007 — Native range input for the seek control

Date: 2026-10-06

## Status

Accepted (spec 14)

## Context

Spec 14 adds chapter ticks, a session-start marker and a second chapter
progress bar to the player timeline. It would be natural to replace the existing
`<input type="range">` with a custom `<div>` so the markers can sit inside a
single drawn track, or with a `<canvas>` so the ticks and fills can be painted.

Accessibility guidance is consistent on both points: a hand-built slider has to
re-implement the entire keyboard contract (arrows, Home/End, PageUp/PageDown)
and the value/role/min/max/max-now semantics that screen readers announce; and
canvas content is not exposed to assistive technology at all, requiring manual
ARIA plus a parallel keyboard path.

The existing e2e suite also drives the control by setting `input.value` through
the native setter and dispatching an `input` event.

## Decision

Keep `<input type="range">` as the only interactive element, and draw the ticks,
the resume marker and the chapter bar as `aria-hidden="true"` decoration
positioned behind or above it, styled with plain CSS/Tailwind (no canvas).

The overlay is `pointer-events: none` and carries no roles. Position information
that a sighted user reads from the ticks is also available as text (the chapter
readout and the chapter list), so nothing is lost by hiding the decoration from
assistive tech.

The per-second readout is deliberately **not** an `aria-live` region: the value
changes several times a second, and announcing each change would make the player
unusable with a screen reader. The native input already announces the seek
position when the listener actually moves it.

## Alternatives considered

- **Canvas-rendered timeline.** Rejected: inaccessible without a parallel
  implementation, and the tick count is in the tens, so the DOM is fine.
- **Custom div slider with full ARIA.** Rejected: hand-rolled keyboard
  behaviour is a recurring source of bugs for no benefit here, and it would
  break the existing e2e helpers.
- **Ticks as `<button>` elements layered over the track.** Rejected: a dozen or
  more focusable stops hijack tab order for a secondary affordance. Chapter
  seeking is already available from the chapter list and the previous/next
  buttons, which are properly focusable.

## Consequences

Marker positions must be derived from the same `position.ts` maths the readout
uses, so the ticks cannot drift from the labels. Visual styling of the
decorative layer is explicitly spec 15's job — spec 14 only proves the
structure.
