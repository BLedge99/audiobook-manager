import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  fetchAppConfig: vi.fn(),
  setToken: vi.fn(),
  setProfile: vi.fn(),
  available: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  boundedFetch: mocks.fetch,
  fetchAppConfig: mocks.fetchAppConfig,
  setSessionToken: mocks.setToken,
  setActiveProfileId: mocks.setProfile,
}));
vi.mock("../lib/apiError", () => ({ responseErrorText: async () => "Sign in failed." }));
vi.mock("../lib/platform", () => ({ isNativeShell: () => false }));
vi.mock("../lib/passkeys", () => ({
  PasskeyError: class PasskeyError extends Error { code = "passkey_failed"; },
  passkeysSupported: () => false,
  signInWithPasskey: vi.fn(),
}));
vi.mock("../lib/biometricVault", () => ({
  biometricVault: { available: mocks.available, unlock: vi.fn(), clear: vi.fn() },
}));
vi.mock("../local/privateCache", () => ({
  lockOfflineCache: vi.fn(),
  rememberProfileKey: vi.fn(),
  unlockProfileCacheWithKey: vi.fn(),
  deleteProfileCache: vi.fn(),
  toBase64: () => "",
  exportActiveProfileKey: vi.fn(),
  fromBase64: () => new Uint8Array(0),
}));

import { AccountGate } from "./AccountGate";

function response(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe("AccountGate continue offline", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    mocks.available.mockResolvedValue(false);
    // Household mode with no accounts: the list view still renders the
    // household password link and the continue offline button.
    mocks.fetch.mockResolvedValue(response(200, []));
    mocks.fetchAppConfig.mockResolvedValue({
      accountExperience: "household",
      oauthProviders: [],
    });
  });

  it("does not render a continue offline button when onContinueOffline is not provided", () => {
    render(<AccountGate onSuccess={vi.fn()} />);
    expect(
      screen.queryByRole("button", { name: /continue offline/i }),
    ).not.toBeInTheDocument();
  });

  it("offers a route to continue offline when onContinueOffline is provided", () => {
    const onContinueOffline = vi.fn();
    render(<AccountGate onSuccess={vi.fn()} onContinueOffline={onContinueOffline} />);
    const continueBtn = screen.getByRole("button", { name: /continue offline/i });
    expect(continueBtn).toBeInTheDocument();

    fireEvent.click(continueBtn);
    expect(onContinueOffline).toHaveBeenCalledOnce();
  });

  it("also offers continue offline in demo mode", () => {
    mocks.fetchAppConfig.mockResolvedValue({
      accountExperience: "demo",
      oauthProviders: [],
    });
    const onContinueOffline = vi.fn();
    render(<AccountGate accountExperience="demo" onSuccess={vi.fn()} onContinueOffline={onContinueOffline} />);
    const continueBtn = screen.getByRole("button", { name: /continue offline/i });
    expect(continueBtn).toBeInTheDocument();
    fireEvent.click(continueBtn);
    expect(onContinueOffline).toHaveBeenCalledOnce();
  });
});
