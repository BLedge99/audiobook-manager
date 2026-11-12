import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  clearServerUrl,
  mediaAssetUrl,
  setAccountExperience,
  setActiveProfileId,
  setServerUrl,
  setSessionToken,
} from "./api";
import { TEST_SERVER_URL } from "../test/constants";

/**
 * The media-token mint may not omit the active-profile header.
 *
 * `/api/auth/media-token` scopes the token to the active profile, resolved
 * from `x-profile-id`; the session token alone does not carry a profile for
 * household sign-ins. `mediaAssetUrl` went through `boundedFetch`, which adds
 * the session header but not the profile header, so the mint always came back
 * 400 `profile_required` — on every platform. Production never noticed
 * because plain stream URLs work over https. This test exists so the request
 * carries the profile header when one is active.
 */
describe("mediaAssetUrl", () => {
  beforeEach(() => {
    window.localStorage.clear();
    // Native stub first: the session token is kept in memory only in the shell.
    Object.defineProperty(window, "Capacitor", { configurable: true, value: { isNativePlatform: () => true } });
    setServerUrl(TEST_SERVER_URL);
    setSessionToken("session-secret");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setActiveProfileId(null);
    setSessionToken(undefined);
    setAccountExperience("household");
    clearServerUrl();
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  });

  function fetchReturningToken(token = "scoped-token") {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("sends the session and active-profile headers when minting a token", async () => {
    setActiveProfileId("9");
    const fetchMock = fetchReturningToken();

    const url = await mediaAssetUrl("/api/tracks/1/stream", "track-stream", 1);

    expect(url).toBe(`${TEST_SERVER_URL}/api/tracks/1/stream?media=scoped-token`);
    expect(fetchMock).toHaveBeenCalledWith(
      `${TEST_SERVER_URL}/api/auth/media-token`,
      expect.objectContaining({ method: "POST" }),
    );
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers["x-house-session"]).toBe("session-secret");
    expect(headers["x-profile-id"]).toBe("9");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("omits the profile header when no profile is active", async () => {
    setActiveProfileId(null);
    const fetchMock = fetchReturningToken();

    await mediaAssetUrl("/api/audiobooks/5/stream", "book-stream", 5);

    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers["x-profile-id"]).toBeUndefined();
    expect(headers["x-house-session"]).toBe("session-secret");
  });

  it("omits the profile header in demo experiences", async () => {
    setAccountExperience("demo");
    setActiveProfileId("9");
    const fetchMock = fetchReturningToken();

    await mediaAssetUrl("/api/audiobooks/5/stream", "book-stream", 5);

    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers["x-profile-id"]).toBeUndefined();
  });
});
