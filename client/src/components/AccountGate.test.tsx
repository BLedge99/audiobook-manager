import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AccountGate } from "./AccountGate";
import { copy } from "../copy";
import { getActiveProfileId, SESSION_TOKEN_KEY } from "../lib/api";

/**
 * Spec 28 — biometric sign-in had no test coverage. The fingerprint button only
 * renders on the native shell with a saved Vault credential, so this test mocks
 * the Capacitor bridge, the Vault plugin and the offline-cache unlock, then
 * taps the button and asserts a server session is established.
 */

type CapacitorWindow = Window & { Capacitor?: { isNativePlatform?: () => boolean } };
const capWindow = window as unknown as CapacitorWindow;

const cacheMocks = vi.hoisted(() => ({
  unlockProfileCacheWithKey: vi.fn().mockResolvedValue(undefined),
  rememberProfileKey: vi.fn().mockResolvedValue(undefined),
  deleteProfileCache: vi.fn().mockResolvedValue(undefined),
  lockOfflineCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../local/privateCache", async (importActual) => {
  const actual = await importActual<typeof import("../local/privateCache")>();
  return {
    ...actual,
    unlockProfileCacheWithKey: cacheMocks.unlockProfileCacheWithKey,
    rememberProfileKey: cacheMocks.rememberProfileKey,
    deleteProfileCache: cacheMocks.deleteProfileCache,
    lockOfflineCache: cacheMocks.lockOfflineCache,
  };
});

const vaultMocks = vi.hoisted(() => ({
  available: vi.fn().mockResolvedValue(true),
  unlock: vi.fn().mockResolvedValue({
    profileId: 7,
    secret: "saved-secret",
    key: "base64key",
  }),
  clear: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/biometricVault", () => ({
  biometricVault: {
    supported: true,
    available: vaultMocks.available,
    hasSavedValue: vi.fn().mockResolvedValue(false),
    save: vi.fn().mockResolvedValue(undefined),
    unlock: vaultMocks.unlock,
    clear: vaultMocks.clear,
  },
}));

const accounts = [
  {
    id: 7,
    name: "Ben",
    color: "var(--mint)",
    role: "member",
    disabled: false,
    hasPassword: true,
    hasPasskey: true,
    hasDeviceUnlock: true,
  },
  {
    id: 8,
    name: "Mum",
    color: "var(--tan)",
    role: "member",
    disabled: false,
    hasPassword: false,
    hasPasskey: false,
  },
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch(overrides: Record<string, (init?: RequestInit) => Response> = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const override = Object.entries(overrides).find(([suffix]) => url.endsWith(suffix));
    if (override) return override[1](init);
    if (url.endsWith("/api/auth/accounts")) return json(accounts);
    return json({ code: "not_found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("AccountGate", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
    delete capWindow.Capacitor;
  });

  it("lists accounts and signs in with that profile's password", async () => {
    mockFetch({
      "/api/auth/login": (init) => {
        const body = JSON.parse(String(init?.body));
        return body.password === "correct-horse-9"
          ? json({ ok: true, token: "session-token", profile: { id: 7 }, role: "member" })
          : json({ code: "incorrect_password" }, 401);
      },
    });
    const onSuccess = vi.fn();
    render(<AccountGate onSuccess={onSuccess} />);

    fireEvent.click(await screen.findByRole("button", { name: /Ben/ }));
    expect(screen.getByPlaceholderText(copy.account.passwordPlaceholder)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(copy.account.passwordPlaceholder), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: copy.login.submit }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(copy.login.wrongPassword));

    fireEvent.change(screen.getByPlaceholderText(copy.account.passwordPlaceholder), {
      target: { value: "correct-horse-9" },
    });
    fireEvent.click(screen.getByRole("button", { name: copy.login.submit }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(window.localStorage.getItem(SESSION_TOKEN_KEY)).toBeNull();
    expect(getActiveProfileId()).toBe("7");
  });

  it("opens the claim form for a profile with no password", async () => {
    mockFetch({
      "/api/auth/claim": () =>
        json({ ok: true, token: "claimed-token", profile: { id: 8 }, role: "member" }),
    });
    const onSuccess = vi.fn();
    render(<AccountGate onSuccess={onSuccess} />);

    fireEvent.click(await screen.findByRole("button", { name: /Mum/ }));
    expect(screen.getByText(copy.account.unclaimedHint)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(copy.login.passwordPlaceholder), {
      target: { value: "household" },
    });
    fireEvent.change(screen.getByPlaceholderText(copy.account.newPasswordLabel), {
      target: { value: "new-password-9" },
    });
    fireEvent.change(screen.getByPlaceholderText(copy.account.confirmPasswordLabel), {
      target: { value: "new-password-9" },
    });
    fireEvent.click(screen.getByRole("button", { name: copy.account.setupSubmit }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(getActiveProfileId()).toBe("8");
  });

  it("rejects a mismatched confirmation without calling the server", async () => {
    const fetchMock = mockFetch();
    render(<AccountGate onSuccess={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: /Mum/ }));
    fireEvent.change(screen.getByPlaceholderText(copy.login.passwordPlaceholder), {
      target: { value: "household" },
    });
    fireEvent.change(screen.getByPlaceholderText(copy.account.newPasswordLabel), {
      target: { value: "new-password-9" },
    });
    fireEvent.change(screen.getByPlaceholderText(copy.account.confirmPasswordLabel), {
      target: { value: "different-password-9" },
    });
    fireEvent.click(screen.getByRole("button", { name: copy.account.setupSubmit }));

    expect(screen.getByRole("alert")).toHaveTextContent(copy.account.mismatch);
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/auth/claim",
      expect.anything(),
    );
  });

  it("keeps the household password as a separate recovery mode", async () => {
    mockFetch({
      "/api/auth/login": () => json({ ok: true, token: "household-token", role: "admin", profile: null }),
    });
    const onSuccess = vi.fn();
    render(<AccountGate onSuccess={onSuccess} />);

    fireEvent.click(await screen.findByRole("button", { name: copy.account.useHousehold }));
    expect(screen.getByText(copy.account.householdIntro)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(copy.login.passwordPlaceholder), {
      target: { value: "household" },
    });
    fireEvent.click(screen.getByRole("button", { name: copy.login.submit }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(window.localStorage.getItem(SESSION_TOKEN_KEY)).toBeNull();
    expect(getActiveProfileId()).toBeNull();
  });

  it("signs in with biometrics when a saved Vault credential exists", async () => {
    vaultMocks.unlock.mockResolvedValueOnce({
      profileId: 7,
      secret: "saved-secret",
      key: "c2VjcmV0",
    });
    const fetchMock = mockFetch({
      "/api/auth/devices/session": () => json({ token: "bio-token" }),
    });
    const onSuccess = vi.fn();

    // Pretend we are running inside the Capacitor native shell.
    capWindow.Capacitor = { isNativePlatform: () => true };
    render(<AccountGate onSuccess={onSuccess} />);

    fireEvent.click(await screen.findByRole("button", { name: /Ben/ }));

    // biometricsAvailable is set asynchronously by the mount effect.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Unlock with fingerprint or face/ }),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /Unlock with fingerprint or face/ }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(getActiveProfileId()).toBe("7");
    expect(cacheMocks.unlockProfileCacheWithKey).toHaveBeenCalledWith(7, expect.any(Uint8Array));
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/devices/session", expect.anything());
    delete capWindow.Capacitor;
  });

  it("retries biometric unlock once when the first prompt fails transiently", async () => {
    let unlockCalls = 0;
    vaultMocks.unlock.mockImplementation(async () => {
      unlockCalls += 1;
      if (unlockCalls === 1) throw new Error("Biometric vault unavailable");
      return { profileId: 7, secret: "saved-secret", key: "c2VjcmV0" };
    });
    const fetchMock = mockFetch({
      "/api/auth/devices/session": () => json({ token: "bio-token" }),
    });
    const onSuccess = vi.fn();

    capWindow.Capacitor = { isNativePlatform: () => true };
    render(<AccountGate onSuccess={onSuccess} />);

    fireEvent.click(await screen.findByRole("button", { name: /Ben/ }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Unlock with fingerprint or face/ }),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /Unlock with fingerprint or face/ }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(getActiveProfileId()).toBe("7");
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/devices/session", expect.anything());
    // The first attempt failed and was retried, so unlock ran twice.
    expect(unlockCalls).toBe(2);
    expect(cacheMocks.unlockProfileCacheWithKey).toHaveBeenCalledWith(7, expect.any(Uint8Array));
    delete capWindow.Capacitor;
  });
});
