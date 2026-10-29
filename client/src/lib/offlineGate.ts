/**
 * The offline screen decision, as data rather than a ladder of `if`s.
 *
 * ## Why this is a pure function
 *
 * The offline branch used to be five nested conditions inside `App.tsx`
 * (`serverReachable`, `device.books.length`, `activeProfileId`,
 * `offlineCacheExists`, `offlineUnlocked`), and every patch to it changed one
 * condition and broke another. The rule this file encodes is:
 *
 * > Being unable to reach the server never dead-ends. If the app cannot prove
 * > something, it says so and leaves a way out.
 *
 * The table is the contract; `offlineGate.test.ts` is the contract's proof.
 *
 * ## What each row means
 *
 * - `waiting` — the device library or the cache check is still running. The
 *   splash is the honest screen: the app does not yet know what it holds.
 * - `libraryReadFailed` — the replica threw. "Nothing downloaded" would be a
 *   lie, and lie is what made downloads look lost (`LIMITATIONS.md` §1.4).
 * - `unlock` — books are here, a profile is known, and its key is only in the
 *   shape of a locked cache. `OfflineUnlock` must offer a way out; see the
 *   component.
 * - `shell` — the normal app, with `progressAvailable` saying whether private
 *   data (progress, favourites) can be read. It is `false` when the cache is
 *   absent, when no profile is known, or when the listener chose to listen
 *   without unlocking. The shelf still works: the replica is not private.
 */

export type OfflineScreen =
  | { kind: "waiting" }
  | { kind: "libraryReadFailed" }
  | { kind: "unlock" }
  | { kind: "shell"; progressAvailable: boolean };

/** Whether this device can prove it holds the profile's key. */
export type CacheState = "unknown" | "present" | "absent";

export interface OfflineGateInput {
  /** The device library is still being read from IndexedDB. */
  deviceLoading: boolean;
  booksOnDevice: number;
  /** Non-null when the replica could not be read at all. */
  libraryReadError: string | null;
  /** A profile is known from the session or the stored hint. */
  hasProfile: boolean;
  cache: CacheState;
  /** A DEK is in memory, so private rows can be read. */
  unlocked: boolean;
  /** The listener chose "listen without progress" from the unlock screen. */
  skippedUnlock: boolean;
}

export function offlineScreen(input: OfflineGateInput): OfflineScreen {
  // 1. Nothing is known yet. Do not guess: a guess here is how "nothing has
  //    been downloaded" was shown to someone holding three books.
  if (input.deviceLoading) return { kind: "waiting" };

  // 2. A library that will not open is not an empty library.
  if (input.libraryReadError) return { kind: "libraryReadFailed" };

  // 3. Unlocking is only worth asking for when there is something to unlock
  //    *for*: books on this device, a known profile, and a cache that exists
  //    or is still being checked.
  const wantsUnlock =
    input.booksOnDevice > 0 &&
    input.hasProfile &&
    input.cache !== "absent" &&
    !input.unlocked &&
    !input.skippedUnlock;

  if (wantsUnlock) {
    if (input.cache === "unknown") return { kind: "waiting" };
    return { kind: "unlock" };
  }

  // 4. Everything else is the app itself. Progress is available exactly when a
  //    key is in memory -- never as a promise the app cannot keep.
  return { kind: "shell", progressAvailable: input.unlocked };
}
