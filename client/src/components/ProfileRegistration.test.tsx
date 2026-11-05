import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { copy } from "../copy";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  setProfile: vi.fn(),
  setToken: vi.fn(),
  rememberKey: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  boundedFetch: mocks.fetch,
  setActiveProfileId: mocks.setProfile,
  setSessionToken: mocks.setToken,
}));
vi.mock("../local/privateCache", () => ({
  rememberProfileKey: mocks.rememberKey,
}));

import { ProfileRegistration } from "./ProfileRegistration";

function response(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe("ProfileRegistration", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    mocks.fetch.mockResolvedValue(response(200, {
      token: "registered-session",
      profile: { id: 17, name: "Sam" },
    }));
    mocks.rememberKey.mockResolvedValue(undefined);
  });

  it("registers against the server and never stores the household password", async () => {
    const onRegistered = vi.fn();
    render(<ProfileRegistration onRegistered={onRegistered} />);
    fireEvent.change(screen.getByLabelText(copy.profile.nameLabel), { target: { value: "Sam" } });
    fireEvent.change(screen.getByLabelText(copy.account.householdPasswordLabel), { target: { value: "household-secret" } });
    fireEvent.change(screen.getByLabelText(copy.account.newPasswordLabel), { target: { value: "sam-password-82" } });
    fireEvent.change(screen.getByLabelText(copy.account.confirmPasswordLabel), { target: { value: "sam-password-82" } });
    fireEvent.click(screen.getByRole("button", { name: copy.account.createProfileSubmit }));

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledWith(
      "/api/auth/register-profile",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "Sam",
          householdPassword: "household-secret",
          password: "sam-password-82",
        }),
      }),
    ));
    await waitFor(() => expect(onRegistered).toHaveBeenCalledWith(17, "registered-session", "sam-password-82"));
    expect(mocks.setProfile).toHaveBeenCalledWith(17);
    expect(mocks.setToken).toHaveBeenCalledWith("registered-session");
    expect(mocks.rememberKey).toHaveBeenCalledWith(17, "sam-password-82");
    expect(JSON.stringify(window.localStorage)).not.toContain("household-secret");
    expect(Object.keys(window.localStorage)).not.toContain("pendingProfiles");
  });
});
