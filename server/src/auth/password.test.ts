import { describe, expect, it } from "vitest";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  hashPassword,
  validatePassword,
  verifyPassword,
} from "./password";

/**
 * Spec 28's policy boundaries and hash format. These are unit tests rather
 * than route tests because the policy is the security boundary: a route can
 * only be as strict as this function.
 */
describe("password policy", () => {
  it("accepts the shortest and longest allowed passwords", () => {
    expect(validatePassword("abcdefgh")).toBeNull();
    expect(validatePassword("a".repeat(PASSWORD_MAX_LENGTH))).toBeNull();
  });

  it("rejects one character below and above the limits with the documented codes", () => {
    expect(validatePassword("a".repeat(PASSWORD_MIN_LENGTH - 1))).toEqual({
      code: "password_too_short",
      params: { minLength: 8 },
    });
    expect(validatePassword("a".repeat(PASSWORD_MAX_LENGTH + 1))).toEqual({
      code: "password_too_long",
      params: { maxLength: 128 },
    });
  });

  it("counts Unicode code points, not UTF-16 units", () => {
    // Eight emoji are 16 UTF-16 units but eight characters to a person.
    expect(validatePassword("🎧".repeat(8))).toBeNull();
    expect(validatePassword("🎧".repeat(7))).toMatchObject({
      code: "password_too_short",
    });
  });

  it("rejects the profile's own name, case-insensitively", () => {
    expect(validatePassword("Bernadette", "Bernadette")).toEqual({
      code: "password_too_weak",
      params: { reason: "profile-name" },
    });
    expect(validatePassword("bErNaDeTtE", "Bernadette")).toMatchObject({
      code: "password_too_weak",
    });
    // A short name is rejected by length first; that is still a rejection, and
    // it never reaches the name check.
    expect(validatePassword("Mum", "Mum")).toMatchObject({ code: "password_too_short" });
  });

  it("rejects the common-password list, including in another case", () => {
    expect(validatePassword("Password")).toEqual({
      code: "password_too_weak",
      params: { reason: "common" },
    });
    expect(validatePassword("qwerty123")).toMatchObject({
      code: "password_too_weak",
    });
  });

  it("accepts an ordinary passphrase", () => {
    expect(validatePassword("correct-horse-9", "Ben")).toBeNull();
  });
});

describe("password hashing", () => {
  it("stores the parameters and a per-hash salt, and verifies the password", async () => {
    const first = await hashPassword("correct-horse-9");
    const second = await hashPassword("correct-horse-9");

    expect(first).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    // Salted: the same password never produces the same stored value.
    expect(first).not.toBe(second);

    expect(await verifyPassword("correct-horse-9", first)).toBe(true);
    expect(await verifyPassword("correct-horse-8", first)).toBe(false);
  });

  it("answers false for a missing, malformed or truncated hash rather than throwing", async () => {
    expect(await verifyPassword("correct-horse-9", null)).toBe(false);
    expect(await verifyPassword("correct-horse-9", "")).toBe(false);
    expect(await verifyPassword("correct-horse-9", "not-a-hash")).toBe(false);
    expect(await verifyPassword("correct-horse-9", "scrypt$0$0$0$aa$bb")).toBe(false);

    const hash = await hashPassword("correct-horse-9");
    // Same format, different digest: the comparison must fail, not the parser.
    const parts = hash.split("$");
    parts[5] = Buffer.alloc(32).toString("base64");
    expect(await verifyPassword("correct-horse-9", parts.join("$"))).toBe(false);
  });
});
