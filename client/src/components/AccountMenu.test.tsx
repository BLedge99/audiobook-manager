import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { copy } from "../copy";

const mocks = vi.hoisted(() => ({
  native: { value: false },
  fetch: vi.fn(),
  browserOpen: vi.fn(async () => undefined),
}));

// Partial mock: the request guarantees (sessionHeaders, resolveApiRequest,
// REQUEST_TIMEOUT_MS) and the URL resolution run for real — the header the
// household deployment depends on is composed by the actual code, not by a
// re-implementation in this file.
vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    boundedFetch: mocks.fetch,
    lockSession: vi.fn(async () => undefined),
    setSessionToken: vi.fn(),
    setActiveProfileId: vi.fn(),
  };
});
vi.mock("../lib/platform", () => ({ isNativeShell: () => mocks.native.value }));
vi.mock("@capacitor/browser", () => ({ Browser: { open: mocks.browserOpen } }));

import { AccountMenu } from "./AccountMenu";

function sessionFor(role: "admin" | "member" | "child") {
  return {
    authDisabled: false,
    profile: { id: 1, name: "Sam", role, ageBand: role === "child" ? "6-9" : null },
    role,
    via: "profile" as const,
    expiresAt: null,
    capabilities: { passkeys: false, devices: true },
  };
}

function renderOpenMenu() {
  render(<AccountMenu session={null} />);
  fireEvent.click(screen.getByRole("button", { name: copy.account.accountMenu }));
}

beforeEach(() => {
  mocks.native.value = false;
  mocks.browserOpen.mockReset();
  mocks.browserOpen.mockResolvedValue(undefined);
  mocks.fetch.mockReset();
  window.localStorage.clear();
});

describe("AccountMenu kids label (spec 41 phase 4)", () => {
  it("labels a kids account", () => {
    render(<AccountMenu session={sessionFor("child")} />);
    fireEvent.click(screen.getByRole("button", { name: copy.account.accountMenu }));
    expect(screen.getByText(copy.account.kidsAccount)).toBeInTheDocument();
  });

  it("does not label an adult account", () => {
    render(<AccountMenu session={sessionFor("member")} />);
    fireEvent.click(screen.getByRole("button", { name: copy.account.accountMenu }));
    expect(screen.queryByText(copy.account.kidsAccount)).not.toBeInTheDocument();
  });
});

describe("AccountMenu privacy notice link", () => {
  it("points the notice at the configured server, not the app origin", () => {
    window.localStorage.setItem("serverUrl", "http://server.example:3000");
    renderOpenMenu();
    const link = screen.getByRole("link", { name: copy.privacy.link });
    expect(link).toHaveAttribute("href", "http://server.example:3000/privacy");
  });

  it("offers no notice link in the shell before a server is configured", () => {
    mocks.native.value = true;
    renderOpenMenu();
    expect(screen.queryByRole("link", { name: copy.privacy.link })).not.toBeInTheDocument();
  });

  it("opens Custom Tabs in the shell instead of navigating the WebView", () => {
    window.localStorage.setItem("serverUrl", "http://server.example:3000");
    mocks.native.value = true;
    renderOpenMenu();
    const link = screen.getByRole("link", { name: copy.privacy.link });
    fireEvent.click(link);
    expect(mocks.browserOpen).toHaveBeenCalledWith({ url: "http://server.example:3000/privacy" });
  });
});

describe("AccountMenu GDPR self-service (spec 42, phase 3)", () => {
  beforeEach(() => {
    // The household deployment: the session is household-level, so the server
    // resolves whose data is being asked for from x-profile-id alone.
    window.localStorage.setItem("serverUrl", "http://server.example:3000");
    window.localStorage.setItem("profileId", "7");
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:my-data") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  });

  it("exports the caller's data with the profile header the household server needs", async () => {
    mocks.fetch.mockResolvedValue(new Response("{}", { status: 200 }));
    // jsdom cannot navigate to the blob: URL the export clicks; the navigation
    // is the browser's, not this suite's to exercise.
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    renderOpenMenu();
    fireEvent.click(screen.getByRole("button", { name: copy.privacy.export }));

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    const [url, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain("/api/me/export");
    expect((init.headers as Record<string, string>)["x-profile-id"]).toBe("7");
  });

  it("erases the caller's account with the profile header the household server needs", async () => {
    mocks.fetch.mockResolvedValue(new Response(null, { status: 204 }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderOpenMenu();
    fireEvent.click(screen.getByRole("button", { name: copy.privacy.erase }));

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    const [url, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain("/api/me");
    expect(init.method).toBe("DELETE");
    expect((init.headers as Record<string, string>)["x-profile-id"]).toBe("7");
  });
});
