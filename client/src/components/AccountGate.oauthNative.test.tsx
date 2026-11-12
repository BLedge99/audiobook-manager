import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { copy } from "../copy";

/**
 * Spec 32 / ADR 030 — the native OAuth surface of the account gate.
 *
 * The module mocks are the same shape as AccountGate.test.tsx, plus the
 * oauthNative module: these tests pin the wiring between the buttons, the
 * Custom Tab opener and the deep-link result consumer, not the module's
 * internals (those live in lib/oauthNative.test.ts).
 */
const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  fetchAppConfig: vi.fn(),
  setToken: vi.fn(),
  setProfile: vi.fn(),
  available: vi.fn(),
  rememberProfileKey: vi.fn(),
  begin: vi.fn(async (_provider: "google" | "github") => undefined),
  subscribe: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  boundedFetch: mocks.fetch,
  fetchAppConfig: mocks.fetchAppConfig,
  setSessionToken: mocks.setToken,
  setActiveProfileId: mocks.setProfile,
  apiUrl: (path: string) => path,
  getPendingProfileId: () => window.localStorage.getItem("pendingProfileId"),
  clearPendingProfileId: () => window.localStorage.removeItem("pendingProfileId"),
}));
vi.mock("../lib/platform", () => ({ isNativeShell: () => true }));
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
vi.mock("../lib/oauthNative", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/oauthNative")>();
  return {
    ...actual,
    beginNativeOAuth: mocks.begin,
    subscribeNativeOAuth: mocks.subscribe,
    registerNativeOAuthListener: vi.fn(),
  };
});

import { AccountGate } from "./AccountGate";
import type { NativeOAuthResult } from "../lib/oauthNative";

function response(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** Surface the last result the gate subscribed for. */
function emit(result: NativeOAuthResult) {
  const [listener] = mocks.subscribe.mock.calls.at(-1) ?? [];
  expect(typeof listener).toBe("function");
  (listener as (result: NativeOAuthResult) => void)(result);
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  mocks.available.mockResolvedValue(false);
  mocks.fetch.mockResolvedValue(response(200, []));
  mocks.fetchAppConfig.mockResolvedValue({
    accountExperience: "demo",
    oauthProviders: ["google", "github"],
  });
  mocks.subscribe.mockImplementation(() => () => undefined);
});

describe("AccountGate native OAuth", () => {
  it("opens the Custom Tab via beginNativeOAuth when the button is pressed", async () => {
    render(<AccountGate accountExperience="demo" onSuccess={vi.fn()} />);

    const button = await screen.findByRole("button", { name: copy.login.oauthGoogleAction });
    fireEvent.click(button);

    expect(mocks.begin).toHaveBeenCalledWith("google");
  });

  it("routes the github button through the native flow too", async () => {
    render(<AccountGate accountExperience="demo" onSuccess={vi.fn()} />);

    const button = await screen.findByRole("button", { name: copy.login.oauthGithubAction });
    fireEvent.click(button);

    expect(mocks.begin).toHaveBeenCalledWith("github");
  });

  it("finishes sign-in when the deep link flow resolves with a token", async () => {
    const onSuccess = vi.fn();
    render(<AccountGate accountExperience="demo" onSuccess={onSuccess} />);

    await screen.findByRole("button", { name: copy.login.oauthGoogleAction });
    emit({ kind: "ok", token: "native-token", profileId: 42 });

    expect(mocks.setToken).toHaveBeenCalledWith("native-token");
    // Demo experience: the token is all that is needed; no profile is selected.
    expect(mocks.setProfile).toHaveBeenCalledWith(null);
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
  });

  it("shows the reviewed sentence when the flow resolves with a provider error", async () => {
    render(<AccountGate accountExperience="demo" onSuccess={vi.fn()} />);

    await screen.findByRole("button", { name: copy.login.oauthGoogleAction });
    emit({ kind: "error", code: "oauth_email_not_verified" });

    expect(await screen.findByText(copy.login.oauthEmailNotVerified)).toBeInTheDocument();
  });

  it("degrades to the reviewed generic sentence for an unknown error code", async () => {
    render(<AccountGate accountExperience="demo" onSuccess={vi.fn()} />);

    await screen.findByRole("button", { name: copy.login.oauthGoogleAction });
    emit({ kind: "error", code: "something_new" });

    expect(await screen.findByText(copy.errors.requestFailed(400))).toBeInTheDocument();
  });
});
