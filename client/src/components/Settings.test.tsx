import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Settings } from "./Settings";
import { TEST_SERVER_URL } from "../test/constants";

/**
 * Spec 26 — the save-server button had no test coverage, which is how a
 * regressed save/health-check flow could ship unnoticed.
 *
 * The sub-components pull in vault / passkey / native APIs that are irrelevant
 * to the save-server flow, so they are rendered as no-ops to keep this test
 * focused on the URL form and the `/api/health` check.
 */
vi.mock("./SessionSettings", () => ({ SessionSettings: () => null }));
vi.mock("./PasswordSettings", () => ({ PasswordSettings: () => null }));
vi.mock("./PasskeySettings", () => ({ PasskeySettings: () => null }));
vi.mock("./DeviceUnlockSettings", () => ({ DeviceUnlockSettings: () => null }));

let fetchMock: ReturnType<typeof vi.fn>;

function fakeResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderSettings(props: Partial<Parameters<typeof Settings>[0]> = {}) {
  return render(<Settings
    usedBytes={0}
    downloadedCount={0}
    offline={false}
    onClose={vi.fn()}
    onSaved={vi.fn()}
    {...props}
  />);
}

describe("Settings save server", () => {
  it("saves the server, reports connected and tells the app on a healthy response", async () => {
    fetchMock.mockResolvedValue(fakeResponse({ status: "ok" }));
    const onSaved = vi.fn();
    renderSettings({ onSaved });

    const input = screen.getByLabelText("Server address");
    fireEvent.change(input, { target: { value: TEST_SERVER_URL } });
    fireEvent.click(screen.getByRole("button", { name: /Save and test/ }));

    await waitFor(() => expect(screen.getByText("Connected.")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(`${TEST_SERVER_URL}/api/health`);
    expect(onSaved).toHaveBeenCalled();
  });

  it("reports failed when the health check returns an error status", async () => {
    fetchMock.mockResolvedValue(fakeResponse({ status: "ok" }, 502));
    renderSettings();

    const input = screen.getByLabelText("Server address");
    fireEvent.change(input, { target: { value: TEST_SERVER_URL } });
    fireEvent.click(screen.getByRole("button", { name: /Save and test/ }));

    await waitFor(() => expect(screen.getByText(/Could not reach/)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalled();
  });

  it("reports failed when the health check cannot connect", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    renderSettings();

    const input = screen.getByLabelText("Server address");
    fireEvent.change(input, { target: { value: TEST_SERVER_URL } });
    fireEvent.click(screen.getByRole("button", { name: /Save and test/ }));

    await waitFor(() => expect(screen.getByText(/Could not reach/)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalled();
  });

  it("reports enter address when the field is empty and does not call fetch", async () => {
    renderSettings();

    fireEvent.click(screen.getByRole("button", { name: /Save and test/ }));

    await waitFor(() => expect(screen.getByText("Enter a server address.")).toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("re-enables the button after a failed check so it can be retried", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    renderSettings();

    const input = screen.getByLabelText("Server address");
    const button = screen.getByRole("button", { name: /Save and test/ });

    fireEvent.change(input, { target: { value: TEST_SERVER_URL } });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByText(/Could not reach/)).toBeInTheDocument());

    // The button must not stay disabled after a failure.
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
