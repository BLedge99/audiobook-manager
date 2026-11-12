import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { copy } from "../copy";

const mocks = vi.hoisted(() => ({
  native: { value: false },
  server: { value: true },
  fetch: vi.fn(),
  browserOpen: vi.fn(async () => undefined),
}));

vi.mock("../lib/api", () => ({
  boundedFetch: mocks.fetch,
  lockSession: vi.fn(async () => undefined),
  setSessionToken: vi.fn(),
  setActiveProfileId: vi.fn(),
  apiUrl: (path: string) => (mocks.server.value ? `http://server.example:3000${path}` : path),
  hasServerUrl: () => mocks.server.value,
}));
vi.mock("../lib/platform", () => ({ isNativeShell: () => mocks.native.value }));
vi.mock("@capacitor/browser", () => ({ Browser: { open: mocks.browserOpen } }));

import { AccountMenu } from "./AccountMenu";

function renderOpenMenu() {
  render(<AccountMenu session={null} />);
  fireEvent.click(screen.getByRole("button", { name: copy.account.accountMenu }));
}

describe("AccountMenu privacy notice link", () => {
  beforeEach(() => {
    mocks.native.value = false;
    mocks.server.value = true;
    mocks.browserOpen.mockReset();
    mocks.browserOpen.mockResolvedValue(undefined);
  });

  it("points the notice at the configured server, not the app origin", () => {
    renderOpenMenu();
    const link = screen.getByRole("link", { name: copy.privacy.link });
    expect(link).toHaveAttribute("href", "http://server.example:3000/privacy");
  });

  it("offers no notice link in the shell before a server is configured", () => {
    mocks.native.value = true;
    mocks.server.value = false;
    renderOpenMenu();
    expect(screen.queryByRole("link", { name: copy.privacy.link })).not.toBeInTheDocument();
  });

  it("opens Custom Tabs in the shell instead of navigating the WebView", () => {
    mocks.native.value = true;
    renderOpenMenu();
    const link = screen.getByRole("link", { name: copy.privacy.link });
    fireEvent.click(link);
    expect(mocks.browserOpen).toHaveBeenCalledWith({ url: "http://server.example:3000/privacy" });
  });
});
