import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SessionSettings } from "./SessionSettings";

afterEach(() => vi.unstubAllGlobals());

describe("SessionSettings", () => {
  it("lists devices and signs one out", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ devices: [
          { key: "current", label: "Laptop", current: true, sessions: 1, createdAt: "2026-10-24T00:00:00Z", lastUsedAt: "2026-10-24T00:00:00Z" },
          { key: "phone", label: "Pixel 4a", current: false, sessions: 3, createdAt: "2026-10-23T00:00:00Z", lastUsedAt: "2026-10-23T00:00:00Z" },
        ] }),
      })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    render(<SessionSettings />);

    expect(await screen.findByText("Pixel 4a")).toBeInTheDocument();
    expect(screen.getByText("Laptop")).toBeInTheDocument();
    // A device that has been used more than once says so.
    expect(screen.getByText("Signed in 3 times")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/sessions/device/phone",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
    await waitFor(() => expect(screen.queryByText("Pixel 4a")).not.toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("That device has been signed out.");
  });

  it("signs every other device out in one action", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ devices: [
          { key: "current", label: "Laptop", current: true, sessions: 1, createdAt: "2026-10-24T00:00:00Z", lastUsedAt: "2026-10-24T00:00:00Z" },
          { key: "phone", label: "Pixel 4a", current: false, sessions: 1, createdAt: "2026-10-23T00:00:00Z", lastUsedAt: "2026-10-23T00:00:00Z" },
          { key: "tablet", label: "Tab S9", current: false, sessions: 1, createdAt: "2026-10-22T00:00:00Z", lastUsedAt: "2026-10-22T00:00:00Z" },
        ] }),
      })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ devices: [
          { key: "current", label: "Laptop", current: true, sessions: 1, createdAt: "2026-10-24T00:00:00Z", lastUsedAt: "2026-10-24T00:00:00Z" },
        ] }),
      });
    vi.stubGlobal("fetch", fetchMock);
    render(<SessionSettings />);

    fireEvent.click(await screen.findByRole("button", { name: "Sign out other devices" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/sessions/others",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
    await waitFor(() => expect(screen.queryByText("Pixel 4a")).not.toBeInTheDocument());
    expect(screen.queryByText("Tab S9")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Every other device has been signed out.");
  });

  it("does not offer the bulk action when this is the only device", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ devices: [
        { key: "current", label: "Laptop", current: true, sessions: 1, createdAt: "2026-10-24T00:00:00Z", lastUsedAt: "2026-10-24T00:00:00Z" },
      ] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<SessionSettings />);

    expect(await screen.findByText("Laptop")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out other devices" })).not.toBeInTheDocument();
  });

  it("does not request online devices while offline", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<SessionSettings offline />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });
});
