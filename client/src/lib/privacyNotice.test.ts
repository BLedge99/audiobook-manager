import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  native: { value: false },
  serverUrl: { value: true },
  open: vi.fn(async () => undefined),
}));

vi.mock("@capacitor/browser", () => ({ Browser: { open: mocks.open } }));
vi.mock("./api", () => ({
  apiUrl: (path: string) => (mocks.serverUrl.value ? `http://server.example:3000${path}` : path),
  hasServerUrl: () => mocks.serverUrl.value,
}));
vi.mock("./platform", () => ({ isNativeShell: () => mocks.native.value }));

import {
  canOpenPrivacyNotice,
  onPrivacyNoticeClick,
  openPrivacyNotice,
  privacyNoticeUrl,
} from "./privacyNotice";

describe("privacyNotice", () => {
  beforeEach(() => {
    mocks.native.value = false;
    mocks.serverUrl.value = true;
    mocks.open.mockReset();
    mocks.open.mockResolvedValue(undefined);
  });

  it("resolves the notice against the configured server", () => {
    expect(privacyNoticeUrl()).toBe("http://server.example:3000/privacy");
  });

  it("falls back to the relative path when no server is configured", () => {
    mocks.serverUrl.value = false;
    expect(privacyNoticeUrl()).toBe("/privacy");
  });

  it("is always openable on the web, even with no configured server", () => {
    mocks.serverUrl.value = false;
    expect(canOpenPrivacyNotice()).toBe(true);
  });

  it("is openable in the shell when a server is configured, and not otherwise", () => {
    mocks.native.value = true;
    expect(canOpenPrivacyNotice()).toBe(true);
    mocks.serverUrl.value = false;
    expect(canOpenPrivacyNotice()).toBe(false);
  });

  it("lets the anchor navigate normally on the web", () => {
    const preventDefault = vi.fn();
    onPrivacyNoticeClick({ preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it("suppresses the anchor and opens Custom Tabs in the shell", () => {
    mocks.native.value = true;
    const preventDefault = vi.fn();
    onPrivacyNoticeClick({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(mocks.open).toHaveBeenCalledWith({ url: "http://server.example:3000/privacy" });
  });

  it("refuses to navigate in the shell when no server is configured", () => {
    mocks.native.value = true;
    mocks.serverUrl.value = false;
    const preventDefault = vi.fn();
    onPrivacyNoticeClick({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it("opens the notice in Custom Tabs directly", async () => {
    await openPrivacyNotice();
    expect(mocks.open).toHaveBeenCalledWith({ url: "http://server.example:3000/privacy" });
  });

  it("falls back to window.open when Custom Tabs refuse", async () => {
    mocks.open.mockRejectedValue(new Error("no browser"));
    const windowOpen = vi.fn(() => null);
    vi.stubGlobal("open", windowOpen);
    await expect(openPrivacyNotice()).resolves.toBeUndefined();
    expect(windowOpen).toHaveBeenCalledWith(
      "http://server.example:3000/privacy",
      "_blank",
      "noopener,noreferrer",
    );
    vi.unstubAllGlobals();
  });
});
