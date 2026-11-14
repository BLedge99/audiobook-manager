/**
 * The "dispense shake": tapping a book card rattles the capsule like the
 * machine is deciding whether to eject it, then the detail opens. Two shakes
 * of ±1.6deg over ~340ms, then navigation -- instant enough not to annoy,
 * unmistakably a toy.
 *
 * Orchestrated here rather than with a bare CSS `:active` because the detail
 * must open *after* the shake, and because a reduced-motion listener should
 * not pay for a delay they were never going to perceive.
 */

let reducedMotionQuery: MediaQueryList | undefined;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    // matchMedia is absent in some test environments; the animation class is
    // harmless there, but the *wait* is not, so treat it as no-preference for
    // the class and keep the timeout short-circuited by the tests' timers.
    return false;
  }
  reducedMotionQuery ??= window.matchMedia("(prefers-reduced-motion: reduce)");
  return reducedMotionQuery.matches;
}

/** Total length of the shake; the detail opens when it lands. */
export const DISPENSE_SHAKE_MS = 340;

/**
 * Shake the `.capsule` ancestor of `from`, then run `open`.
 *
 * Reduced motion, a missing capsule, or an already-animating one never trap
 * the listener: every path ends in `open`, exactly once.
 */
export function dispenseShakeThen(from: Element | null, open: () => void): void {
  const card = from?.closest(".capsule");
  if (!(card instanceof HTMLElement) || prefersReducedMotion()) {
    open();
    return;
  }
  card.classList.remove("dispense-shake");
  // Reflow so a capsule mid-shake can be interrupted and shaken again rather
  // than silently no-op'ing on a class that never left.
  void card.offsetWidth;
  card.classList.add("dispense-shake");
  window.setTimeout(() => {
    card.classList.remove("dispense-shake");
    open();
  }, DISPENSE_SHAKE_MS);
}
