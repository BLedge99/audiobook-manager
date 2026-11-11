import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { fetchAppConfig, fetchSession, getActiveProfileId } from "./api";
import { probeServer } from "./reachability";
import { useSession, type UseSessionOptions } from "./useSession";

vi.mock("./api", () => ({
  fetchAppConfig: vi.fn(),
  fetchSession: vi.fn(),
  getActiveProfileId: vi.fn(() => "3"),
  setActiveProfileId: vi.fn(),
  setSessionToken: vi.fn(),
}));

vi.mock("./reachability", () => ({
  probeServer: vi.fn(),
}));

/**
 * Spec 37, step 4.5 — the session probe as a hook.
 *
 * The probe used to live inline in `App.tsx`, where it reconciled the probe
 * with the session fetch and guarded its own re-entrancy. These tests pin the
 * three behaviours the App could not: that the two questions (is the server
 * there? is the listener accepted?) are answered separately, that one probe at a
 * time is in flight, and that an unreachable server leaves the stored hint be.
 */

function baseOptions(): UseSessionOptions {
  return {
    offlineModeRef: { current: false },
    accountExperience: "household",
    session: null,
    authed: undefined,
    serverReachable: undefined,
    setServerReachable: vi.fn(),
    setAuthed: vi.fn(),
    setSession: vi.fn(),
    setSessionToken: vi.fn(),
    setProfileId: vi.fn(),
    setActiveProfileId: vi.fn(),
    setAccountExperience: vi.fn(),
    setApiAccountExperience: vi.fn(),
    setBypassServerSetup: vi.fn(),
  };
}

describe("useSession", () => {
  beforeEach(() => {
    vi.mocked(fetchAppConfig).mockReset();
    vi.mocked(fetchAppConfig).mockResolvedValue({ accountExperience: "household", oauthProviders: [] });
    vi.mocked(fetchSession).mockReset();
    vi.mocked(getActiveProfileId).mockReset();
    vi.mocked(getActiveProfileId).mockReturnValue("3");
    vi.mocked(probeServer).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports unreachable and not-authenticated separately", async () => {
    // The server is up but the listener is not: reachable, not authenticated.
    vi.mocked(probeServer).mockResolvedValue({ reachable: true, authed: false });

    const options = baseOptions();
    const { unmount } = renderHook(() => useSession(options));

    await waitFor(() => expect(options.setServerReachable).toHaveBeenCalledWith(true));
    expect(options.setAuthed).toHaveBeenCalledWith(false);
    unmount();
  });

  it("does not re-probe while a probe is in flight", async () => {
    let resolveProbe: (value: { reachable: boolean; authed: boolean }) => void = () => undefined;
    vi.mocked(probeServer).mockImplementation(
      () => new Promise<{ reachable: boolean; authed: boolean }>((resolve) => { resolveProbe = resolve; }) as Promise<never>,
    );

    const options = baseOptions();
    const { result } = renderHook(() => useSession(options));

    let first: Promise<void> | undefined;
    act(() => {
      first = result.current.probeServer();
    });
    await act(async () => {
      result.current.probeServer();
    });
    expect(probeServer).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveProbe({ reachable: true, authed: true });
      await first;
    });
    expect(probeServer).toHaveBeenCalledTimes(1);
  });

  it("does not clear the profile hint when the server is unreachable", async () => {
    vi.mocked(probeServer).mockResolvedValue({ reachable: false, authed: false });

    const options = baseOptions();
    const { unmount } = renderHook(() => useSession(options));

    await waitFor(() => expect(options.setServerReachable).toHaveBeenCalledWith(false));
    // The stored hint is the break-glass fallback, not garbage: it survives an
    // unreachable server.
    expect(options.setProfileId).toHaveBeenCalledWith("3");
    unmount();
  });
});
