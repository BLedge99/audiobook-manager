import { describe, expect, it } from "vitest";
import {
  INACTIVE_PROFILE_RETENTION_MS,
  PROFILE_PERSONAL_DATA_MODELS,
  eraseProfilePersonalData,
  exportProfilePersonalData,
  inactiveProfileCutoff,
  purgeInactiveProfiles,
} from "./personal-data";

describe("the personal-data tables (spec 37 step 6.1)", () => {
  it("lists every table that holds personal data", () => {
    // The one list the export, erasure and retention purge all read. Ordered
    // children-before-profile so a delete can run without FK violations.
    expect(PROFILE_PERSONAL_DATA_MODELS).toEqual([
      "webAuthnChallenge",
      "webAuthnCredential",
      "deviceCredential",
      "session",
      "listeningHistory",
      "playSession",
      "favourite",
      "wishlistItem",
      "profileLibraryEntry",
      "profile",
    ]);
  });

  it("is what the export reads", () => {
    expect(typeof exportProfilePersonalData).toBe("function");
  });

  it("is what the erasure reads", () => {
    expect(typeof eraseProfilePersonalData).toBe("function");
  });

  it("is what the retention purge reads", () => {
    expect(typeof purgeInactiveProfiles).toBe("function");
  });

  it("owns the 24-month inactive-profile retention constant", () => {
    expect(INACTIVE_PROFILE_RETENTION_MS).toBe(24 * 30 * 24 * 60 * 60 * 1000);
    expect(inactiveProfileCutoff(new Date("2026-01-01T00:00:00.000Z")).toISOString()).toBe(
      "2024-01-12T00:00:00.000Z",
    );
  });
});
