import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/**
 * Password hashing and policy (spec 28 / ADR 016).
 *
 * Built-in `scrypt` deliberately: the server has to run on a Raspberry Pi, and
 * a native argon2 dependency is a build problem before it is a security
 * improvement. The parameters are stored with the hash so raising the cost
 * later does not need a migration.
 */

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;
// 128 * N * r is 33.5 MiB at these parameters; the Node default (32 MiB) is
// just below it and makes scrypt throw.
const MAX_MEMORY = 64 * 1024 * 1024;

const WEAK_PASSWORDS = new Set([
  "password",
  "password1",
  "password123",
  "12345678",
  "123456789",
  "1234567890",
  "qwertyui",
  "qwerty123",
  "letmein1",
  "iloveyou",
  "admin123",
  "welcome1",
]);

export type PasswordFailureCode =
  | "password_too_short"
  | "password_too_long"
  | "password_too_weak";

export interface PasswordFailure {
  code: PasswordFailureCode;
  params: { minLength?: number; maxLength?: number; reason?: string };
}

/**
 * Validate before hashing. `profileName` is optional because a reset or claim
 * always knows it; a unit test can omit it.
 */
export function validatePassword(password: string, profileName?: string): PasswordFailure | null {
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) {
    return { code: "password_too_short", params: { minLength: PASSWORD_MIN_LENGTH } };
  }
  if (length > PASSWORD_MAX_LENGTH) {
    return { code: "password_too_long", params: { maxLength: PASSWORD_MAX_LENGTH } };
  }
  if (profileName && password.trim().toLocaleLowerCase() === profileName.trim().toLocaleLowerCase()) {
    return { code: "password_too_weak", params: { reason: "profile-name" } };
  }
  if (WEAK_PASSWORDS.has(password.toLocaleLowerCase())) {
    return { code: "password_too_weak", params: { reason: "common" } };
  }
  return null;
}

/** `scrypt$N$r$p$saltBase64$hashBase64` */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: MAX_MEMORY,
  });
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

/**
 * Verify a stored hash. Returns false for a malformed or unknown format rather
 * than throwing; a corrupt row must not turn a login failure into a 500.
 */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  if (n < 2 || r < 1 || p < 1) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], "base64");
    expected = Buffer.from(parts[5], "base64");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  try {
    const actual = await scrypt(password, salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: MAX_MEMORY,
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
