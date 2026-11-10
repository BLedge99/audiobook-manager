import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { copy } from "../copy";
const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  fetchAppConfig: vi.fn(),
  setToken: vi.fn(),
  setProfile: vi.fn(),
  available: vi.fn(),
  rememberProfileKey: vi.fn(),
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
  rememberProfileKey: mocks.rememberProfileKey,
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

  it("offers registration instead of treating an empty account list as a dead end", async () => {
    render(<AccountGate onSuccess={vi.fn()} />);
    expect(await screen.findByText("No profiles have been set up on this server yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: copy.account.createProfile }));
    expect(screen.getByLabelText(copy.profile.nameLabel)).toBeInTheDocument();
    expect(screen.getByLabelText(copy.account.householdPasswordLabel)).toBeInTheDocument();
  });

  it("signs into a selected local household profile with its password", async () => {
    const account = {
      id: 41,
      name: "Test Listener",
      color: null,
      role: "member" as const,
      disabled: false,
      hasPassword: true,
      hasPasskey: false,
      hasDeviceUnlock: false,
    };
    const onSuccess = vi.fn();
    mocks.fetch
      .mockResolvedValueOnce(response(200, [account]))
      .mockResolvedValueOnce(response(200, { token: "profile-session", profile: { id: account.id } }));
    render(<AccountGate onSuccess={onSuccess} />);

    fireEvent.click(await screen.findByRole("button", { name: account.name }));
    fireEvent.change(screen.getByLabelText(copy.account.passwordLabel(account.name)), {
      target: { value: "listener-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: copy.login.submit }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith({ offline: false }));
    expect(mocks.fetch).toHaveBeenNthCalledWith(2, "/api/auth/login", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ profileId: account.id, password: "listener-password" }),
    }));
    expect(mocks.setToken).toHaveBeenCalledWith("profile-session");
    expect(mocks.setProfile).toHaveBeenCalledWith(account.id);
  });

  it("does not describe an account-list failure as an empty server", async () => {
    mocks.fetch.mockRejectedValueOnce(new Error("network unavailable"));
    render(<AccountGate onSuccess={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("network unavailable");
    expect(screen.queryByText("No profiles have been set up on this server yet.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: copy.account.createProfile })).not.toBeInTheDocument();
  });

  it("also offers continue offline in demo mode", () => {
    mocks.fetchAppConfig.mockResolvedValue({
      accountExperience: "demo",
      oauthProviders: [],
    });
    const onContinueOffline = vi.fn();
    render(<AccountGate accountExperience="demo" onSuccess={vi.fn()} onContinueOffline={onContinueOffline} />);
    expect(screen.queryByRole("link", { name: copy.login.oauthGoogleAction })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: copy.login.oauthGithubAction })).not.toBeInTheDocument();
    const continueBtn = screen.getByRole("button", { name: /continue offline/i });
    expect(continueBtn).toBeInTheDocument();
    fireEvent.click(continueBtn);
    expect(onContinueOffline).toHaveBeenCalledOnce();
  });

  it("shows only the OAuth providers enabled by the server in demo mode", async () => {
    mocks.fetchAppConfig.mockResolvedValue({
      accountExperience: "demo",
      oauthProviders: ["google"],
    });
    render(<AccountGate accountExperience="demo" onSuccess={vi.fn()} />);

    expect(await screen.findByRole("link", { name: copy.login.oauthGoogleAction }))
      .toHaveAttribute("href", "/api/auth/google/authorize");
    expect(screen.queryByRole("link", { name: copy.login.oauthGithubAction })).not.toBeInTheDocument();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
