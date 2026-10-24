import { describe, expect, it } from "vitest";
import { deviceLabelFromUserAgent } from "./session";

describe("session device labels", () => {
  it("maps common platform strings to concise labels without echoing the user agent", () => {
    expect(deviceLabelFromUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140"))
      .toBe("Windows device");
    expect(deviceLabelFromUserAgent("Mozilla/5.0 (Linux; Android 13; Pixel 4a) Chrome/140"))
      .toBe("Android device");
    expect(deviceLabelFromUserAgent("custom agent")).toBeNull();
    expect(deviceLabelFromUserAgent(null)).toBeNull();
  });
});
