import { describe, it, expect } from "vitest";
import { isPrivacyPath } from "./privacyPath";

describe("isPrivacyPath", () => {
  it("recognises the notice, with or without a trailing slash, case-insensitively", () => {
    expect(isPrivacyPath("/privacy")).toBe(true);
    expect(isPrivacyPath("/privacy/")).toBe(true);
    expect(isPrivacyPath("/PRIVACY")).toBe(true);
  });

  it("does not catch the application shell or other routes", () => {
    expect(isPrivacyPath("/")).toBe(false);
    expect(isPrivacyPath("/privacy-notice")).toBe(false);
    expect(isPrivacyPath("/api/privacy")).toBe(false);
    expect(isPrivacyPath("")).toBe(false);
    expect(isPrivacyPath(undefined)).toBe(false);
  });
});
