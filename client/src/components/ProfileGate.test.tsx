import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { copy } from "../copy";
import { ProfileGate } from "./ProfileGate";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.stubGlobal("fetch", mocks.fetch);

function response(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe("ProfileGate", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    // ProfileGate fetches the profile list on mount; stub it so the screen
    // renders without a real server.
    mocks.fetch.mockResolvedValue(response(200, []));
  });

  it("does not render a continue offline button when onContinueOffline is not provided", () => {
    render(<ProfileGate onSuccess={vi.fn()} />);
    expect(
      screen.queryByRole("button", { name: /continue offline/i }),
    ).not.toBeInTheDocument();
  });

  it("offers a route to continue offline when onContinueOffline is provided", () => {
    const onContinueOffline = vi.fn();
    render(<ProfileGate onSuccess={vi.fn()} onContinueOffline={onContinueOffline} />);
    const continueBtn = screen.getByRole("button", { name: /continue offline/i });
    expect(continueBtn).toBeInTheDocument();

    fireEvent.click(continueBtn);
    expect(onContinueOffline).toHaveBeenCalledOnce();
  });

  it("shows a real registration form when the server confirms there are no profiles", async () => {
    render(<ProfileGate onSuccess={vi.fn()} />);
    expect(await screen.findByText(copy.account.noProfiles)).toBeInTheDocument();
    expect(screen.getByLabelText(copy.account.householdPasswordLabel)).toBeInTheDocument();
    expect(screen.getByLabelText(copy.account.newPasswordLabel)).toBeInTheDocument();
  });

  it("keeps a failed profile request distinct from an empty list", async () => {
    mocks.fetch.mockRejectedValueOnce(new Error("network unavailable"));
    render(<ProfileGate onSuccess={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(copy.profile.unreachable(copy.profile.checkAddress));
    expect(screen.queryByText(copy.account.noProfiles)).not.toBeInTheDocument();
    expect(Object.keys(window.localStorage)).not.toContain("offlineProfile_-1");
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
  });
});
