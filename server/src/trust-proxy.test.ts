import { describe, it, expect } from "vitest";
import { parseTrustProxy } from "./trust-proxy";

describe("parseTrustProxy", () => {
  it("trusts nothing by default", () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy("")).toBe(false);
    expect(parseTrustProxy("   ")).toBe(false);
  });

  it("'true' means one proxy hop, not every proxy on the internet", () => {
    const predicate = parseTrustProxy("true");
    expect(typeof predicate).toBe("function");
    if (typeof predicate === "function") {
      expect(predicate("203.0.113.9", 0)).toBe(true);   // the edge closest to us
      expect(predicate("198.51.100.2", 1)).toBe(false); // beyond the one hop
    }
  });

  it("a digit count is a hop-count predicate", () => {
    const predicate = parseTrustProxy("2");
    expect(typeof predicate).toBe("function");
    if (typeof predicate === "function") {
      expect(predicate("203.0.113.9", 0)).toBe(true);
      expect(predicate("203.0.113.9", 1)).toBe(true);
      expect(predicate("203.0.113.9", 2)).toBe(false);
    }
  });

  it("a list of addresses is used verbatim", () => {
    expect(parseTrustProxy("172.30.28.2")).toEqual(["172.30.28.2"]);
    expect(parseTrustProxy("10.0.0.1, ::1")).toEqual(["10.0.0.1", "::1"]);
  });
});
