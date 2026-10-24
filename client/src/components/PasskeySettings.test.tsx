import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { copy } from "../copy";

const mocks = vi.hoisted(() => ({
  listPasskeys: vi.fn(),
  addPasskey: vi.fn(),
  removePasskey: vi.fn(),
}));

vi.mock("../lib/passkeys", () => ({
  ...mocks,
  passkeysSupported: () => true,
  PasskeyError: class PasskeyError extends Error {
    constructor(readonly code: string) {
      super(code);
      this.name = "PasskeyError";
    }
  },
}));

import { PasskeySettings } from "./PasskeySettings";

const saved = {
  id: "passkey-1",
  label: "Windows Hello",
  createdAt: "2026-10-20T10:00:00.000Z",
  lastUsedAt: "2026-10-22T10:00:00.000Z",
  backedUp: false,
};

describe("PasskeySettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists the profile's passkeys and removes one", async () => {
    mocks.listPasskeys.mockResolvedValue({ configured: true, passkeys: [saved] });
    mocks.removePasskey.mockResolvedValue(undefined);

    render(<PasskeySettings />);
    expect(await screen.findByText("Windows Hello")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: copy.security.remove }));
    await waitFor(() => expect(mocks.removePasskey).toHaveBeenCalledWith(saved.id));
    expect(await screen.findByText(copy.security.removed)).toBeTruthy();
  });

  it("adds a passkey and shows it in the list", async () => {
    mocks.listPasskeys.mockResolvedValue({ configured: true, passkeys: [] });
    mocks.addPasskey.mockResolvedValue({ ...saved, id: "passkey-2" });

    render(<PasskeySettings />);
    expect(await screen.findByText(copy.security.empty)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: copy.security.add }));
    await waitFor(() => expect(mocks.addPasskey).toHaveBeenCalled());
    expect(await screen.findByText(copy.security.added)).toBeTruthy();
    expect(screen.getByText("Windows Hello")).toBeTruthy();
  });

  it("renders nothing when the server has passkeys turned off", async () => {
    mocks.listPasskeys.mockResolvedValue({ configured: false, passkeys: [] });

    const { container } = render(<PasskeySettings />);
    await waitFor(() => expect(mocks.listPasskeys).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });
});
