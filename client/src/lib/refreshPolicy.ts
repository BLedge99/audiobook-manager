/**
 * Spec 37, step 4.2 — the refresh-trigger rules.
 *
 * Six effects raced to refresh the same shelf in `App.tsx`: a library tick, a
 * profile change, window focus, a visibility change, a server-reachable
 * transition, and the mount. The policy decides what the shelf is owed; the
 * App asks it.
 */

export type RefreshTrigger =
  /** Progress was saved while a book was open; the tick counter moved. */
  | { kind: "library-tick"; tick: number }
  /** The listener's profile changed, so the shelf is a different shelf. */
  | { kind: "profile-changed"; profileId: string }
  /** The window regained focus. */
  | { kind: "window-focus" }
  /** The document became visible. */
  | { kind: "visibility-visible"; becameVisible: boolean }
  /** The server was unreachable and has since come back. */
  | { kind: "server-recovered" };

/**
 * Does this trigger owe the shelf a refresh?
 *
 *  - a **library tick** is always owed: progress saved while a book was open
 *    must reach the grid, and a refetch no longer blanks the shelf anyway.
 *  - a **profile change** is owed: a different listener profile is a different
 *    shelf and a different progress scope.
 *  - **window focus** is owed: the shelf may have gone stale.
 *  - **visibility** is owed only on a transition *into* visibility; an event
 *    that arrives while already visible is a no-op.
 *  - **server recovery** is owed: while the server was unreachable the shelf
 *    was the device's, so the server's list is stale the moment it answers.
 */
export function refreshTriggered(trigger: RefreshTrigger): boolean {
  switch (trigger.kind) {
    case "library-tick":
      return true;
    case "profile-changed":
      return true;
    case "window-focus":
      return true;
    case "visibility-visible":
      return trigger.becameVisible;
    case "server-recovered":
      return true;
  }
}
