import { describe, it, expect } from "vitest";
import { isValidIsbn13, isValidIsbn10, isbn10To13, normaliseIsbn } from "./isbn";

describe("isValidIsbn13", () => {
  it("accepts a checksum-valid 978/979 ISBN", () => {
    expect(isValidIsbn13("9780439023528")).toBe(true);
    expect(isValidIsbn13("9780306406157")).toBe(true);
  });

  it("rejects a flipped check digit", () => {
    expect(isValidIsbn13("9780439023529")).toBe(false);
  });

  it("rejects wrong length, wrong prefix, non-digits", () => {
    expect(isValidIsbn13("97804390232")).toBe(false);
    expect(isValidIsbn13("97804390235280")).toBe(false);
    expect(isValidIsbn13("1234567890123")).toBe(false);
    expect(isValidIsbn13("978043902352X")).toBe(false);
  });
});

describe("isValidIsbn10", () => {
  it("accepts the classic valid vector 0-306-40615-2", () => {
    expect(isValidIsbn10("0306406152")).toBe(true);
  });

  it("accepts X as the check digit", () => {
    expect(isValidIsbn10("080442957X")).toBe(true);
  });

  it("rejects a bad check digit", () => {
    expect(isValidIsbn10("0306406153")).toBe(false);
  });

  it("tolerates hyphens at call time", () => {
    expect(isValidIsbn10("0-306-40615-2")).toBe(true);
  });
});

describe("isbn10To13", () => {
  it("converts 0-306-40615-2 → 9780306406157", () => {
    expect(isbn10To13("0306406152")).toBe("9780306406157");
  });

  it("round-trips: the converted value validates", () => {
    const converted = isbn10To13("0306406152");
    expect(converted && isValidIsbn13(converted)).toBe(true);
  });

  it("returns null for an invalid source", () => {
    expect(isbn10To13("0306406153")).toBeNull();
  });
});

describe("normaliseIsbn", () => {
  it("strips hyphens and spaces from an ISBN-13", () => {
    expect(normaliseIsbn("978-0-439-02352-8")).toBe("9780439023528");
  });

  it("converts a valid ISBN-10 to 13", () => {
    expect(normaliseIsbn("0-306-40615-2")).toBe("9780306406157");
  });

  it("returns undefined for garbage", () => {
    expect(normaliseIsbn("hello")).toBeUndefined();
    expect(normaliseIsbn(undefined)).toBeUndefined();
    expect(normaliseIsbn("")).toBeUndefined();
  });

  it("is strict: an ISBN-13 with a bad checksum is undefined, not repaired", () => {
    expect(normaliseIsbn("9780439023529")).toBeUndefined();
  });
});
