import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Settings } from "./Settings";
import { setOfflineMode } from "../lib/offlineMode";
import { RECENT_SERVERS_KEY } from "../lib/recentServers";
import { TEST_SERVER_URL } from "../test/constants";

const OTHER_SERVER_URL = "http://other-server:3000";

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
  setOfflineMode(false);
});

afterEach(() => {
  setOfflineMode(false);
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
    // The URL is the first argument; the second is the request init.
    expect(fetchMock.mock.calls[0][0]).toBe(`${TEST_SERVER_URL}/api/health`);
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

  it("still tests the address when the app is in explicit offline mode", async () => {
    // Regression: offline mode used to refuse the request inside the client,
    // so "Save and test" reported the app's own offline choice as a network
    // failure and the listener had no way out from Settings once the former
    // "Reconnect to server" button was removed.
    setOfflineMode(true);
    fetchMock.mockResolvedValue(fakeResponse({ status: "ok" }));
    const onSaved = vi.fn();
    renderSettings({ onSaved });

    const input = screen.getByLabelText("Server address");
    fireEvent.change(input, { target: { value: TEST_SERVER_URL } });
    fireEvent.click(screen.getByRole("button", { name: /Save and test/ }));

    await waitFor(() => expect(screen.getByText("Connected.")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalled();
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

describe("Settings recent servers (spec 40)", () => {
  it("records the address in the recent list after a successful save", async () => {
    fetchMock.mockResolvedValue(fakeResponse({ status: "ok" }));
    renderSettings();

    const input = screen.getByLabelText("Server address");
    fireEvent.change(input, { target: { value: TEST_SERVER_URL } });
    fireEvent.click(screen.getByRole("button", { name: /Save and test/ }));

    await waitFor(() => expect(screen.getByText("Connected.")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: TEST_SERVER_URL })).toBeInTheDocument();
  });

  it("does not record the address when the health check fails", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    renderSettings();

    const input = screen.getByLabelText("Server address");
    fireEvent.change(input, { target: { value: TEST_SERVER_URL } });
    fireEvent.click(screen.getByRole("button", { name: /Save and test/ }));

    await waitFor(() => expect(screen.getByText(/Could not reach/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: TEST_SERVER_URL })).not.toBeInTheDocument();
    expect(window.localStorage.getItem(RECENT_SERVERS_KEY)).toBeNull();
  });

  it("switches to a recent address through the same save-and-test flow when tapped", async () => {
    window.localStorage.setItem(RECENT_SERVERS_KEY, JSON.stringify([OTHER_SERVER_URL]));
    fetchMock.mockResolvedValue(fakeResponse({ status: "ok" }));
    const onSaved = vi.fn();
    renderSettings({ onSaved });

    fireEvent.click(screen.getByRole("button", { name: OTHER_SERVER_URL }));

    await waitFor(() => expect(screen.getByText("Connected.")).toBeInTheDocument());
    expect(fetchMock.mock.calls[0][0]).toBe(`${OTHER_SERVER_URL}/api/health`);
    expect(window.localStorage.getItem("serverUrl")).toBe(OTHER_SERVER_URL);
    expect(onSaved).toHaveBeenCalled();
    // The field shows the address that was switched to.
    expect(screen.getByLabelText("Server address")).toHaveValue(OTHER_SERVER_URL);
  });

  it("marks the configured server as Current", async () => {
    window.localStorage.setItem("serverUrl", TEST_SERVER_URL);
    renderSettings();

    await waitFor(() => expect(screen.getByText("Current")).toBeInTheDocument());
  });

  it("forgets an entry without changing the configured server", async () => {
    window.localStorage.setItem("serverUrl", TEST_SERVER_URL);
    window.localStorage.setItem(RECENT_SERVERS_KEY, JSON.stringify([OTHER_SERVER_URL]));
    renderSettings();

    fireEvent.click(screen.getByRole("button", { name: `Forget ${OTHER_SERVER_URL}` }));

    expect(screen.queryByRole("button", { name: OTHER_SERVER_URL })).not.toBeInTheDocument();
    expect(window.localStorage.getItem("serverUrl")).toBe(TEST_SERVER_URL);
  });

  it("renders with no list when the stored data is malformed", () => {
    window.localStorage.setItem(RECENT_SERVERS_KEY, "not json{{{");
    renderSettings();

    expect(screen.queryByText("Recent servers")).not.toBeInTheDocument();
  });
});
