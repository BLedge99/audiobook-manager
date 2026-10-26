import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { copy } from "../copy";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  available: vi.fn(),
  hasSavedValue: vi.fn(),
  save: vi.fn(),
  clear: vi.fn(),
  exportKey: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  boundedFetch: mocks.fetch,
  getActiveProfileId: () => "7",
}));
vi.mock("../lib/platform", () => ({ isNativeShell: () => true }));
vi.mock("../lib/biometricVault", () => ({
  biometricVault: {
    supported: () => true,
    available: mocks.available,
    hasSavedValue: mocks.hasSavedValue,
    save: mocks.save,
    clear: mocks.clear,
  },
}));
vi.mock("../local/privateCache", () => ({
  activeCacheKey: () => ({}),
  exportActiveProfileKey: mocks.exportKey,
  toBase64: () => "dGVzdC1rZXk=",
}));

import { DeviceUnlockSettings } from "./DeviceUnlockSettings";

function response(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe("DeviceUnlockSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.available.mockResolvedValue(true);
    mocks.hasSavedValue.mockResolvedValue(false);
    mocks.exportKey.mockResolvedValue(new Uint8Array(32));
    mocks.fetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return response(200, { id: "device-1", secret: "secret-value" });
      return response(200, { devices: [] });
    });
  });

  it("enrolls the current device and stores the secret with the profile key in the Vault", async () => {
    mocks.save.mockResolvedValue(undefined);
    render(<DeviceUnlockSettings />);

    fireEvent.click(await screen.findByRole("button", { name: copy.security.deviceEnable }));

    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({
      profileId: 7, secret: "secret-value", key: "dGVzdC1rZXk=",
    }));
    expect(mocks.fetch).toHaveBeenCalledWith("/api/auth/devices", expect.objectContaining({ method: "POST" }));
    expect(await screen.findByRole("status")).toHaveTextContent(copy.security.deviceReady);
  });

  it("revokes a saved device and clears its local Vault", async () => {
    mocks.hasSavedValue.mockResolvedValue(true);
    mocks.fetch.mockImplementation(async (url: string) => url === "/api/auth/devices"
      ? response(200, { devices: [{ id: "device-1", label: "Pixel" }] })
      : response(200, { ok: true }));
    render(<DeviceUnlockSettings />);

    fireEvent.click(await screen.findByRole("button", { name: copy.security.remove }));

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledWith(
      "/api/auth/devices/device-1", { method: "DELETE" },
    ));
    expect(mocks.clear).toHaveBeenCalledOnce();
    expect(await screen.findByRole("status")).toHaveTextContent(copy.security.deviceRemoved);
  });

  it("hides enrollment while offline", () => {
    const { container } = render(<DeviceUnlockSettings offline />);
    expect(container).toBeEmptyDOMElement();
  });
});
