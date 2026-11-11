import { describe, it, expect } from "vitest";
import { resolveProfileContext } from "./profiles";

/**
 * Spec 37, step 4.1 — the profile-resolution rules.
 *
 * `App.tsx` used to compute the shelf profile and the player profile from the
 * session and the stored hint with two ternaries that shared no code and were
 * covered by nothing. The listener-visible question is simple though — which
 * profile's shelf is on screen, and which one is progress saved under — so it
 * belongs in one tested place.
 */

describe("resolveProfileContext", () => {
  it("prefers the session profile over the stored hint", () => {
    const context = resolveProfileContext({
      accountExperience: "household",
      sessionProfile: { id: 7 },
      storedProfileId: "3",
    });

    expect(context.activeProfileId).toBe("7");
    expect(context.playerProfileId).toBe("7");
  });

  it("falls back to the stored hint in household mode", () => {
    const context = resolveProfileContext({
      accountExperience: "household",
      sessionProfile: null,
      storedProfileId: "3",
    });

    expect(context.activeProfileId).toBe("3");
    expect(context.playerProfileId).toBe("3");
  });

  it("uses the account profile in demo mode", () => {
    const context = resolveProfileContext({
      accountExperience: "demo",
      sessionProfile: { id: 7 },
      storedProfileId: "3",
    });

    // The shelf is the session profile's; the player saves under the account.
    expect(context.activeProfileId).toBe("7");
    expect(context.playerProfileId).toBe("demo-account");
  });

  it("keeps the player profile distinct from the shelf profile", () => {
    const context = resolveProfileContext({
      accountExperience: "demo",
      sessionProfile: { id: 7 },
      storedProfileId: "3",
    });

    expect(context.playerProfileId).toBe("demo-account");
    expect(context.activeProfileId).toBe("7");
  });
});
