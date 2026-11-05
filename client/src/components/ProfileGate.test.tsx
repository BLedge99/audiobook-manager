import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
});
