import { describe, it, expect } from "vitest";
import { refreshTriggered } from "./refreshPolicy";

/**
 * Spec 37, step 4.2 — the refresh-trigger rules.
 *
 * Six effects raced to refresh the same shelf in `App.tsx`: a library tick, a
 * profile change, window focus, a visibility change, a server-reachable
 * transition, and the mount. The policy decides, the App asks. These tests pin
 * what each trigger is worth.
 */

describe("refreshTriggered", () => {
  it("refreshes when the profile changes", () => {
    expect(refreshTriggered({ kind: "profile-changed", profileId: "3" })).toBe(true);
  });

  it("refreshes when the window regains focus", () => {
    expect(refreshTriggered({ kind: "window-focus" })).toBe(true);
  });

  it("refreshes when the server comes back", () => {
    expect(refreshTriggered({ kind: "server-recovered" })).toBe(true);
  });

  it("does not refresh on a visibility change that was already visible", () => {
    expect(refreshTriggered({ kind: "visibility-visible", becameVisible: false })).toBe(false);
  });
});
