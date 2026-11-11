import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deviceName,
  deviceNameFromUserAgent,
  getInstallationId,
  newInstallationId,
} from "./deviceIdentity";

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const PIXEL =
  "Mozilla/5.0 (Linux; Android 13; Pixel 4a Build/TQ3A.230805.001; wv) Version/4.0 Chrome/110.0.0.0 Mobile Safari/537.1";
const MOTOROLA =
  "Mozilla/5.0 (Linux; Android 11; Motorola Defy Build/RP1A.201005.001; wv) Version/4.0 Chrome/95.0.0.0 Mobile Safari/537.36";
const SAMSUNG =
  "Mozilla/5.0 (Linux; Android 13; SM-S911B Build/TP1A.220624.014; wv) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36";
const WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

describe("deviceNameFromUserAgent", () => {
  it("reads the phone's model out of the Android user agent", () => {
    expect(deviceNameFromUserAgent(PIXEL)).toBe("Pixel 4a");
    expect(deviceNameFromUserAgent(MOTOROLA)).toBe("Motorola Defy");
    expect(deviceNameFromUserAgent(SAMSUNG)).toBe("SM-S911B");
  });

  it("returns null when there is no Android model to read", () => {
    expect(deviceNameFromUserAgent(WINDOWS)).toBeNull();
    expect(deviceNameFromUserAgent(null)).toBeNull();
    expect(deviceNameFromUserAgent(undefined)).toBeNull();
    expect(deviceNameFromUserAgent("")).toBeNull();
  });

  it("refuses a user agent in disguise rather than showing it as a name", () => {
    const long = `Mozilla/5.0 (Linux; Android 13; ${"x".repeat(80)} Build/1; wv)`;
    expect(deviceNameFromUserAgent(long)).toBeNull();
  });
});

describe("the installation id", () => {
  it("is created once and kept afterwards", () => {
    const first = getInstallationId();
    expect(first.length).toBeGreaterThan(10);
    expect(getInstallationId()).toBe(first);
  });

  it("is different for a different installation", () => {
    expect(newInstallationId()).not.toBe(newInstallationId());
  });

  it("survives a storage failure by sending no id at all", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    expect(getInstallationId()).toBe("");
    getItem.mockRestore();
  });
});

describe("deviceName", () => {
  it("falls back to the given name when the user agent says nothing", () => {
    expect(deviceName("This device")).toBe("This device");
  });
});
