import { describe, it, expect, afterEach, vi } from "vitest";
import { getAffiliateTags, isCommissionable } from "./affiliateConfig";

/**
 * Phase 0.3 — build-time affiliate tags (spec 39 / ADR 034).
 *
 * The app must work, visually and functionally, with every VITE_AFFILIATE_*
 * unset. A configured tag only decides whether one buy row says it is an ad
 * (and earns the household a commission). Absent config == untagged == the
 * same links.
 *
 * Amazon is deliberately not representable here: no VITE_AFFILIATE_AMAZON
 * exists and must never be added (sideloaded app cannot be an Approved
 * Mobile Application; see ADR 034 and spec 39).
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

function stub(env: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value as string);
  }
}

describe("getAffiliateTags", () => {
  it("returns empty config when no VITE_AFFILIATE_* is set", () => {
    stub({
      VITE_AFFILIATE_LIBROFM: undefined,
      VITE_AFFILIATE_BOOKSHOP: undefined,
      VITE_AFFILIATE_KOBO: undefined,
      VITE_AFFILIATE_BN: undefined,
    });
    expect(getAffiliateTags()).toEqual({});
  });

  it("reads each configured tag verbatim", () => {
    stub({
      VITE_AFFILIATE_LIBROFM: "librofm-123",
      VITE_AFFILIATE_KOBO: "kobo-us-456",
    });
    expect(getAffiliateTags()).toEqual({ librofm: "librofm-123", kobo: "kobo-us-456" });
  });

  it("ignores empty-string tags (a set-but-empty var is untagged)", () => {
    stub({ VITE_AFFILIATE_LIBROFM: "" });
    expect(getAffiliateTags()).toEqual({});
  });

  it("never exposes an Amazon tag slot", () => {
    stub({ VITE_AFFILIATE_AMAZON: "abc-20" } as unknown as Record<string, string>);
    expect(getAffiliateTags()).not.toHaveProperty("amazon");
  });
});

describe("isCommissionable", () => {
  it("is false for every vendor when nothing is configured", () => {
    stub({});
    for (const id of ["librofm", "bookshop", "kobo", "bn"] as const) {
      expect(isCommissionable(id)).toBe(false);
    }
  });

  it("is true only for the configured vendors", () => {
    stub({ VITE_AFFILIATE_KOBO: "kobo-us-456" });
    expect(isCommissionable("kobo")).toBe(true);
    expect(isCommissionable("librofm")).toBe(false);
    expect(isCommissionable("bookshop")).toBe(false);
    expect(isCommissionable("bn")).toBe(false);
  });

  it("Audible is never commissionable in this app", () => {
    stub({ VITE_AFFILIATE_AUDIBLE: "x-20" } as unknown as Record<string, string>);
    expect(getAffiliateTags()).not.toHaveProperty("audible");
  });
});
