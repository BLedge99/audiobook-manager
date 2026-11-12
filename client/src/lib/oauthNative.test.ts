import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Spec 32 / ADR 030 — the native half of the OAuth round trip.
 *
 * The WebView cannot authorise anyone at the provider (Google blocks embedded
 * user-agents; the session cookie never reaches the native client anyway), so
 * the Android app hands the flow to Chrome Custom Tabs and gets the answer
 * back as a deep link. These tests hold that contract: absolute authorize URL,
 * one-time state-bound handoff exchange, and honest failure reporting.
 */
const mocks = vi.hoisted(() => ({
  open: vi.fn(async (_options: { url: string }) => undefined),
  close: vi.fn(async () => undefined),
  getLaunchUrl: vi.fn(async () => ({ url: undefined as string | undefined })),
  addListener: vi.fn(async () => ({ remove: vi.fn(async () => undefined) })),
}));

vi.mock("@capacitor/browser", () => ({ Browser: { open: mocks.open, close: mocks.close } }));
vi.mock("@capacitor/app", () => ({
  App: { getLaunchUrl: mocks.getLaunchUrl, addListener: mocks.addListener },
}));

const platformMock = vi.hoisted(() => ({ native: true }));
vi.mock("./platform", () => ({ isNativeShell: () => platformMock.native }));

import {
  beginNativeOAuth,
  handleOAuthDeepLink,
  resetNativeOAuthState,
  subscribeNativeOAuth,
  type NativeOAuthResult,
} from "./oauthNative";

const SERVER = "http://192.168.1.203:3001";

let fetchMock: ReturnType<typeof vi.fn>;

function response(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

function collect() {
  const results: NativeOAuthResult[] = [];
  const unsubscribe = subscribeNativeOAuth((result) => results.push(result));
  return { results, unsubscribe };
}

function authorizeUrl(): URL {
  const url = (mocks.open.mock.calls.at(-1)![0] as { url: string }).url;
  return new URL(url);
}

const CALLBACK = "com.technative.audiobookmanager://oauth/callback";

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.localStorage.setItem("serverUrl", SERVER);
  resetNativeOAuthState();
  platformMock.native = true;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

describe("beginNativeOAuth", () => {
  it("refuses to run outside the native shell", async () => {
    platformMock.native = false;
    await expect(beginNativeOAuth("google")).rejects.toThrow(/native/i);
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it("opens the configured server's authorize endpoint with a random state", async () => {
    await beginNativeOAuth("google");

    expect(mocks.open).toHaveBeenCalledTimes(1);
    const url = authorizeUrl();
    expect(url.origin).toBe(SERVER);
    expect(url.pathname).toBe("/api/auth/google/authorize");
    expect(url.searchParams.get("client")).toBe("native");
    expect(url.searchParams.get("state")).toBeTruthy();
    expect((url.searchParams.get("state") ?? "").length).toBeGreaterThanOrEqual(16);
  });

  it("mints a fresh state every call", async () => {
    await beginNativeOAuth("google");
    const first = authorizeUrl().searchParams.get("state");
    await beginNativeOAuth("github");
    const second = authorizeUrl().searchParams.get("state");
    expect(first).not.toBe(second);
  });

  it("builds on the configured server even for github", async () => {
    await beginNativeOAuth("github");
    const url = authorizeUrl();
    expect(url.pathname).toBe("/api/auth/github/authorize");
  });
});

describe("handleOAuthDeepLink", () => {
  it("round trip: exchanges the code and notifies the subscriber once", async () => {
    fetchMock.mockResolvedValue(
      response(200, { token: "native-token", profile: { id: 42, name: "Someone", color: null, role: "member" }, expiresAt: "soon" }),
    );
    const { results } = collect();

    await beginNativeOAuth("github");
    const state = authorizeUrl().searchParams.get("state")!;
    await handleOAuthDeepLink(`${CALLBACK}?code=the-code&state=${state}`);

    expect(mocks.close).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0];
    expect(String(input)).toBe(`${SERVER}/api/auth/oauth/handoff`);
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ code: "the-code", state });
    expect(results).toEqual([{ kind: "ok", token: "native-token", profileId: 42 }]);
  });

  it("ignores a URL with a different scheme or path entirely", async () => {
    const { results } = collect();
    await beginNativeOAuth("google");

    await handleOAuthDeepLink("https://192.168.1.203:3001/oauth/callback?code=x&state=y");
    await handleOAuthDeepLink(`${CALLBACK}/wrong?code=x&state=y`);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });

  it("reports a state mismatch and makes no network call", async () => {
    const { results } = collect();
    await beginNativeOAuth("google");

    await handleOAuthDeepLink(`${CALLBACK}?code=the-code&state=forged`);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(results).toEqual([{ kind: "error", code: "oauth_state_mismatch" }]);
  });

  it("surfaces the server-told reason from an auth_error deep link", async () => {
    const { results } = collect();
    await beginNativeOAuth("google");

    await handleOAuthDeepLink(`${CALLBACK}?auth_error=oauth_email_not_verified`);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(results).toEqual([{ kind: "error", code: "oauth_email_not_verified" }]);
  });

  it("reports oauth_handoff_invalid when the exchange is rejected", async () => {
    fetchMock.mockResolvedValue(response(401, { code: "oauth_handoff_invalid" }));
    const { results } = collect();

    await beginNativeOAuth("google");
    const state = authorizeUrl().searchParams.get("state")!;
    await handleOAuthDeepLink(`${CALLBACK}?code=spent-code&state=${state}`);

    expect(mocks.close).toHaveBeenCalled();
    expect(results).toEqual([{ kind: "error", code: "oauth_handoff_invalid" }]);
  });

  it("delivers an unsubscribed result exactly once on the next subscribe", async () => {
    fetchMock.mockResolvedValue(
      response(200, { token: "native-token", profile: { id: 7, name: "x", color: null, role: "member" } }),
    );
    await beginNativeOAuth("google");
    const state = authorizeUrl().searchParams.get("state")!;
    // No subscriber yet: the result is parked, cold-start style.
    await handleOAuthDeepLink(`${CALLBACK}?code=the-code&state=${state}`);

    const first: NativeOAuthResult[] = [];
    const unsubscribe = subscribeNativeOAuth((result) => first.push(result));
    unsubscribe();
    expect(first).toEqual([{ kind: "ok", token: "native-token", profileId: 7 }]);

    const second: NativeOAuthResult[] = [];
    subscribeNativeOAuth((result) => second.push(result));
    expect(second).toEqual([]);
  });

  it("discards a stale parked result when a new flow begins", async () => {
    fetchMock.mockResolvedValue(
      response(200, { token: "native-token", profile: { id: 7, name: "x", color: null, role: "member" } }),
    );
    await beginNativeOAuth("google");
    const state = authorizeUrl().searchParams.get("state")!;
    await handleOAuthDeepLink(`${CALLBACK}?code=the-code&state=${state}`);

    // The user gives up on the dead flow and starts a new one.
    await beginNativeOAuth("google");

    const results: NativeOAuthResult[] = [];
    subscribeNativeOAuth((result) => results.push(result));
    expect(results).toEqual([]);
  });
});
