import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { copy } from "../copy";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  rewrapProfileKey: vi.fn(),
  deleteProfileCache: vi.fn(),
  profileId: "7",
}));

vi.mock("../lib/api", () => ({
  apiFetch: mocks.apiFetch,
  getActiveProfileId: () => mocks.profileId,
}));

vi.mock("../local/privateCache", () => ({
  rewrapProfileKey: mocks.rewrapProfileKey,
  deleteProfileCache: mocks.deleteProfileCache,
}));

import { PasswordSettings } from "./PasswordSettings";

function fill(current: string, next: string, confirm = next) {
  fireEvent.change(screen.getByLabelText(copy.security.currentPasswordLabel), {
    target: { value: current },
  });
  fireEvent.change(screen.getByLabelText(copy.account.newPasswordLabel), {
    target: { value: next },
  });
  fireEvent.change(screen.getByLabelText(copy.account.confirmPasswordLabel), {
    target: { value: confirm },
  });
}

describe("PasswordSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.profileId = "7";
    mocks.apiFetch.mockResolvedValue({ ok: true });
    mocks.rewrapProfileKey.mockResolvedValue(true);
    mocks.deleteProfileCache.mockResolvedValue(undefined);
  });

  it("changes the password and re-wraps the local key", async () => {
    render(<PasswordSettings />);
    fill("old-password-9", "new-password-9");
    fireEvent.click(screen.getByRole("button", { name: copy.security.passwordChange }));

    await waitFor(() =>
      expect(mocks.apiFetch).toHaveBeenCalledWith("/api/auth/password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: "old-password-9",
          newPassword: "new-password-9",
        }),
      }),
    );
    await waitFor(() =>
      expect(mocks.rewrapProfileKey).toHaveBeenCalledWith(
        7,
        "old-password-9",
        "new-password-9",
      ),
    );
    expect(await screen.findByText(copy.security.passwordChanged)).toBeInTheDocument();
    expect(mocks.deleteProfileCache).not.toHaveBeenCalled();
  });

  it("does not call the server when the two new passwords differ", async () => {
    render(<PasswordSettings />);
    fill("old-password-9", "new-password-9", "different-password-9");
    fireEvent.click(screen.getByRole("button", { name: copy.security.passwordChange }));

    expect(await screen.findByText(copy.account.mismatch)).toBeInTheDocument();
    expect(mocks.apiFetch).not.toHaveBeenCalled();
    expect(mocks.rewrapProfileKey).not.toHaveBeenCalled();
  });

  it("shows the reviewed sentence when the current password is wrong", async () => {
    mocks.apiFetch.mockRejectedValue(new Error(copy.login.wrongPassword));
    render(<PasswordSettings />);
    fill("not-the-password", "new-password-9");
    fireEvent.click(screen.getByRole("button", { name: copy.security.passwordChange }));

    expect(await screen.findByRole("alert")).toHaveTextContent(copy.login.wrongPassword);
    expect(mocks.rewrapProfileKey).not.toHaveBeenCalled();
  });

  it("deletes the stale local copy when the key cannot be re-wrapped", async () => {
    mocks.rewrapProfileKey.mockRejectedValue(new Error("unwrap failed"));
    render(<PasswordSettings />);
    fill("old-password-9", "new-password-9");
    fireEvent.click(screen.getByRole("button", { name: copy.security.passwordChange }));

    await waitFor(() => expect(mocks.deleteProfileCache).toHaveBeenCalledWith(7));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(copy.security.passwordChanged);
    expect(status).toHaveTextContent(copy.security.passwordCacheReset);
  });

  it("renders nothing offline or without a signed-in profile", () => {
    const first = render(<PasswordSettings offline />);
    expect(first.container).toBeEmptyDOMElement();
    first.unmount();

    mocks.profileId = "";
    const second = render(<PasswordSettings />);
    expect(second.container).toBeEmptyDOMElement();
  });
});
