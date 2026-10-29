import { describe, expect, it } from "vitest";
import { offlineScreen, type OfflineGateInput } from "./offlineGate";

/**
 * Spec 29. One test per row of the behaviour table in `specs/29-offline-resilience.md`.
 *
 * The failures these lock down, all of them observed or read out of the code:
 * - a phone with three downloads was told "nothing has been downloaded";
 * - a replica that would not open looked identical to an empty one;
 * - an unlock screen with no exit trapped a listener whose stored key had been
 *   invalidated by enrolling a new fingerprint;
 * - a listener with no profile and no server was walled out of the app.
 */

const base: OfflineGateInput = {
  deviceLoading: false,
  booksOnDevice: 2,
  libraryReadError: null,
  hasProfile: true,
  cache: "present",
  unlocked: false,
  skippedUnlock: false,
};

function screen(overrides: Partial<OfflineGateInput>) {
  return offlineScreen({ ...base, ...overrides });
}

describe("the offline screen", () => {
  it("waits rather than guessing while the device library is read", () => {
    expect(screen({ deviceLoading: true })).toEqual({ kind: "waiting" });
  });

  it("waits rather than flashing a notice when there are no books yet", () => {
    expect(screen({ deviceLoading: true, booksOnDevice: 0 })).toEqual({ kind: "waiting" });
  });

  it("reports a library that would not open instead of calling it empty", () => {
    expect(screen({ libraryReadError: "QuotaExceededError" })).toEqual({
      kind: "libraryReadFailed",
    });
  });

  it("lets a listener in when the cache is absent, without progress", () => {
    expect(screen({ cache: "absent" })).toEqual({
      kind: "shell",
      progressAvailable: false,
    });
  });

  it("asks for the key when books, a profile and a cache are all present", () => {
    expect(screen({})).toEqual({ kind: "unlock" });
  });

  it("does not ask for a key before the cache check has finished", () => {
    expect(screen({ cache: "unknown" })).toEqual({ kind: "waiting" });
  });

  it("never asks for a key when there is nothing downloaded", () => {
    expect(screen({ booksOnDevice: 0 })).toEqual({
      kind: "shell",
      progressAvailable: false,
    });
  });

  it("never asks for a key when no profile is known", () => {
    expect(screen({ hasProfile: false })).toEqual({
      kind: "shell",
      progressAvailable: false,
    });
  });

  it("honours a listener who chose to listen without unlocking", () => {
    expect(screen({ skippedUnlock: true })).toEqual({
      kind: "shell",
      progressAvailable: false,
    });
  });

  it("goes straight to the shelf when the key is already in memory", () => {
    expect(screen({ unlocked: true })).toEqual({
      kind: "shell",
      progressAvailable: true,
    });
  });

  it("never returns a screen without an action when books exist", () => {
    // The rule, stated as an assertion: for every combination of the inputs
    // that describe a phone holding books, the result is a screen the listener
    // can act on. `waiting` is the only exception, and it resolves itself.
    for (const cache of ["unknown", "present", "absent"] as const) {
      for (const hasProfile of [true, false]) {
        for (const unlocked of [true, false]) {
          for (const skippedUnlock of [true, false]) {
            const result = screen({ cache, hasProfile, unlocked, skippedUnlock });
            expect(["waiting", "unlock", "shell"]).toContain(result.kind);
          }
        }
      }
    }
  });
});
