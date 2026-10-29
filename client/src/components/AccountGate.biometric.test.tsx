import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { copy } from "../copy";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  unlock: vi.fn(),
  available: vi.fn(),
  clear: vi.fn(),
  setToken: vi.fn(),
  setProfile: vi.fn(),
  unlockKey: vi.fn(),
  deleteCache: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  boundedFetch: mocks.fetch,
  setSessionToken: mocks.setToken,
  setActiveProfileId: mocks.setProfile,
}));
vi.mock("../lib/apiError", () => ({ responseErrorText: async () => "Sign in failed." }));
vi.mock("../lib/platform", () => ({ isNativeShell: () => true }));
vi.mock("../lib/passkeys", () => ({
  PasskeyError: class PasskeyError extends Error { code = "passkey_failed"; },
  passkeysSupported: () => false,
  signInWithPasskey: vi.fn(),
}));
vi.mock("../lib/biometricVault", () => ({
  biometricVault: { available: mocks.available, unlock: mocks.unlock, clear: mocks.clear },
}));
vi.mock("../local/privateCache", () => ({
  lockOfflineCache: vi.fn(),
  rememberProfileKey: vi.fn(),
  unlockProfileCacheWithKey: mocks.unlockKey,
  deleteProfileCache: mocks.deleteCache,
  fromBase64: () => new Uint8Array(32),
}));

import { AccountGate } from "./AccountGate";

function response(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe("AccountGate biometric sign-in", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.available.mockResolvedValue(true);
    mocks.unlock.mockResolvedValue({ profileId: 7, secret: "device-secret", key: "wrapped-dek" });
    mocks.fetch.mockImplementation(async (path: string) => {
      if (path === "/api/auth/accounts") return response(200, [{
        id: 7, name: "Ben", role: "member", disabled: false,
        hasPassword: true, hasPasskey: false, hasDeviceUnlock: true,
      }]);
      return response(200, { token: "device-session", profile: { id: 7 } });
    });
  });

  it("exchanges the Vault secret and restores the matching private key", async () => {
    const onSuccess = vi.fn();
    render(<AccountGate onSuccess={onSuccess} />);
    fireEvent.click(await screen.findByRole("button", { name: /Ben/ }));
    fireEvent.click(await screen.findByRole("button", { name: copy.security.deviceSignIn }));

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledWith(
      "/api/auth/devices/session",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ secret: "device-secret" }) }),
    ));
    expect(mocks.unlockKey).toHaveBeenCalledWith(7, expect.any(Uint8Array));
    expect(mocks.setToken).toHaveBeenCalledWith("device-session");
    expect(mocks.setProfile).toHaveBeenCalledWith(7);
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it("falls back to the password form when the prompt is cancelled", async () => {
    mocks.unlock.mockRejectedValue(new Error("cancelled"));
    const onSuccess = vi.fn();
    render(<AccountGate onSuccess={onSuccess} />);
    fireEvent.click(await screen.findByRole("button", { name: /Ben/ }));
    fireEvent.click(await screen.findByRole("button", { name: copy.security.deviceSignIn }));

    await waitFor(() => expect(mocks.unlock).toHaveBeenCalledOnce());
    // A cancellation is a choice, not a failure: no error is shouted back, and
    // the password form simply stays where it was (spec 29).
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mocks.setToken).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    // Biometrics never traps a person: the password field is still there.
    expect(screen.getByLabelText(copy.account.passwordLabel("Ben"))).toBeInTheDocument();
    expect(mocks.deleteCache).not.toHaveBeenCalled();
  });

  it("does not retry a native prompt the listener explicitly cancelled", async () => {
    mocks.unlock.mockRejectedValue(new Error("Biometric prompt error code 10: User canceled"));
    render(<AccountGate onSuccess={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /Ben/ }));
    fireEvent.click(await screen.findByRole("button", { name: copy.security.deviceSignIn }));

    await waitFor(() => expect(mocks.unlock).toHaveBeenCalledOnce());
    // The old table retried codes 5/10/13, so pressing "Use password" re-opened
    // the prompt. Cancelling must never do that.
    expect(mocks.unlock).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mocks.clear).not.toHaveBeenCalled();
  });

  it("says a fingerprint must be enrolled when the sensor is unavailable", async () => {
    // A profile with device sign-in set up, but Android has no biometric
    // enrolled: the explanation replaces the silently missing button (spec 29).
    mocks.available.mockResolvedValue(false);
    render(<AccountGate onSuccess={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /Ben/ }));

    expect(await screen.findByText(copy.security.deviceUnavailable)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: copy.security.deviceSignIn }),
    ).not.toBeInTheDocument();
  });

  it("clears a revoked device secret and its stale offline private data", async () => {    mocks.fetch.mockImplementation(async (path: string) => path === "/api/auth/accounts"
      ? response(200, [{ id: 7, name: "Ben", role: "member", disabled: false, hasPassword: true, hasPasskey: false, hasDeviceUnlock: true }])
      : response(401, { code: "device_auth_failed" }));
    render(<AccountGate onSuccess={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /Ben/ }));
    fireEvent.click(await screen.findByRole("button", { name: copy.security.deviceSignIn }));

    expect(await screen.findByRole("alert")).toHaveTextContent(copy.login.deviceGone);
    expect(mocks.clear).toHaveBeenCalledOnce();
    expect(mocks.deleteCache).toHaveBeenCalledWith(7);
  });
});
