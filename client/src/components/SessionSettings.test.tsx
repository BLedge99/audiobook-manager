import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SessionSettings } from "./SessionSettings";

afterEach(() => vi.unstubAllGlobals());

describe("SessionSettings", () => {
  it("lists active sessions and revokes another device", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sessions: [
          { id: "current", deviceLabel: "Laptop", current: true, createdAt: "2026-10-24T00:00:00Z", lastUsedAt: "2026-10-24T00:00:00Z" },
          { id: "phone", deviceLabel: "Pixel", current: false, createdAt: "2026-10-23T00:00:00Z", lastUsedAt: "2026-10-23T00:00:00Z" },
        ] }),
      })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    render(<SessionSettings />);

    expect(await screen.findByText("Pixel")).toBeInTheDocument();
    expect(screen.getByText("Laptop")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/auth/sessions/phone", expect.objectContaining({ method: "DELETE" })));
    await waitFor(() => expect(screen.queryByText("Pixel")).not.toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("That device has been signed out.");
  });

  it("does not request online sessions while offline", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<SessionSettings offline />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });
});
