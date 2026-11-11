import { describe, it, expect } from "vitest";
import { planDeviceSessionPrune, type DeviceSessionRow } from "./deviceSessions";

/**
 * Spec 36: the cleanup for the sessions that predate device identity.
 *
 * The rules are pure, so they are tested here rather than against a
 * database. What matters: a phone keeps working, a phone ends up as one row,
 * and two identical phones are not mistaken for one.
 */

const AGENT = "Mozilla/5.0 (Linux; Android 13; Pixel 4a Build/TQ3A) Chrome/120";

function row(over: Partial<DeviceSessionRow> & { id: string }): DeviceSessionRow {
  return {
    profileId: 1,
    userAgent: AGENT,
    deviceCredentialId: null,
    lastUsedAt: new Date("2026-11-01T00:00:00Z"),
    ...over,
  };
}

describe("planDeviceSessionPrune", () => {
  it("keeps one row for a phone that signed in many times", () => {
    const sessions = [
      row({ id: "old", lastUsedAt: new Date("2026-10-01T00:00:00Z") }),
      row({ id: "middle", lastUsedAt: new Date("2026-10-20T00:00:00Z") }),
      row({ id: "new", lastUsedAt: new Date("2026-11-01T00:00:00Z") }),
    ];
    const plan = planDeviceSessionPrune(sessions, []);
    expect(plan.keep).toEqual(["new"]);
    expect(plan.revoke.sort()).toEqual(["middle", "old"]);
  });

  it("adopts the surviving row into the device's credential", () => {
    const plan = planDeviceSessionPrune(
      [row({ id: "new", lastUsedAt: new Date("2026-11-01T00:00:00Z") })],
      [{ id: "credential-1", profileId: 1 }],
    );
    expect(plan.link).toEqual([{ sessionId: "new", credentialId: "credential-1" }]);
  });

  it("does not adopt a row when the profile has more than one device", () => {
    const plan = planDeviceSessionPrune(
      [row({ id: "new" })],
      [
        { id: "credential-1", profileId: 1 },
        { id: "credential-2", profileId: 1 },
      ],
    );
    expect(plan.link).toEqual([]);
    expect(plan.keep).toEqual(["new"]);
  });

  it("drops the older rows when the phone already has a linked session", () => {
    const plan = planDeviceSessionPrune(
      [
        row({ id: "legacy", lastUsedAt: new Date("2026-10-01T00:00:00Z") }),
        row({ id: "linked", deviceCredentialId: "credential-1", lastUsedAt: new Date("2026-11-01T00:00:00Z") }),
      ],
      [{ id: "credential-1", profileId: 1 }],
    );
    expect(plan.keep).toEqual(["linked"]);
    expect(plan.revoke).toEqual(["legacy"]);
    expect(plan.link).toEqual([]);
  });

  it("keeps one session per credential, so two identical phones stay apart", () => {
    const plan = planDeviceSessionPrune(
      [
        row({ id: "phone-a-old", deviceCredentialId: "credential-1", lastUsedAt: new Date("2026-10-01T00:00:00Z") }),
        row({ id: "phone-a-new", deviceCredentialId: "credential-1", lastUsedAt: new Date("2026-11-01T00:00:00Z") }),
        row({ id: "phone-b", deviceCredentialId: "credential-2", lastUsedAt: new Date("2026-11-02T00:00:00Z") }),
      ],
      [
        { id: "credential-1", profileId: 1 },
        { id: "credential-2", profileId: 1 },
      ],
    );
    expect(plan.keep.sort()).toEqual(["phone-a-new", "phone-b"]);
    expect(plan.revoke).toEqual(["phone-a-old"]);
  });

  it("does not touch another profile's rows", () => {
    const plan = planDeviceSessionPrune(
      [
        row({ id: "mine", profileId: 1, lastUsedAt: new Date("2026-11-01T00:00:00Z") }),
        row({ id: "theirs", profileId: 2, lastUsedAt: new Date("2026-10-01T00:00:00Z") }),
      ],
      [],
    );
    expect(plan.keep.sort()).toEqual(["mine", "theirs"]);
    expect(plan.revoke).toEqual([]);
  });
});
