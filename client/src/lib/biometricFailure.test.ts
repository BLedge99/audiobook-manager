import { describe, expect, it } from "vitest";
import {
  BIOMETRIC_CANCELLED,
  BIOMETRIC_ERROR,
  BIOMETRIC_LOCKOUT,
  BIOMETRIC_TRANSIENT,
  BIOMETRIC_UNAVAILABLE,
  VAULT_KEY_INVALID,
  VAULT_UNAVAILABLE,
  biometricFailureMessage,
  classifyBiometricFailure,
  shouldClearSavedKey,
  shouldRetryBiometricSave,
  shouldRetryBiometricUnlock,
} from "./biometricFailure";

/**
 * Spec 29. The classification table behind the fingerprint lifecycle.
 *
 * The real bug this covers: pressing "Use password" (androidx code 13) used to
 * be retried, so the prompt re-opened after the listener had declined it, and a
 * Keystore key invalidated by a new fingerprint enrolment was reported as a
 * generic failure with no way forward.
 *
 * The native side delivers a stable `code` on the rejection (PluginCall's
 * code slot, copied onto the Error by Capacitor's bridge). The client
 * classifies on that contract only -- the message is for humans, and no
 * English sentence may decide whether a phone clears its saved key.
 */

/** An error shaped like Capacitor's rejection: code = the contract, message = prose. */
function nativeError(code: string | null | undefined, message = "human-readable failure") {
  const error = new Error(message) as Error & { code?: string | null };
  error.code = code;
  return error;
}

const copy = {
  failed: "Fingerprint or face unlock didn't work. Use your password.",
  locked: "Too many tries with fingerprint or face. Wait a moment, or sign in with your password.",
  needsSetup:
    "Device sign-in no longer works on this phone. Sign in with your password, then set it up again in Settings.",
};

describe("classifying a biometric failure", () => {
  it("reads the native taxonomy code", () => {
    expect(classifyBiometricFailure(nativeError(VAULT_KEY_INVALID))).toBe("key-invalid");
    expect(classifyBiometricFailure(nativeError(BIOMETRIC_CANCELLED))).toBe("cancelled");
    expect(classifyBiometricFailure(nativeError(BIOMETRIC_LOCKOUT))).toBe("lockout");
    expect(classifyBiometricFailure(nativeError(BIOMETRIC_UNAVAILABLE))).toBe("unavailable");
    expect(classifyBiometricFailure(nativeError(BIOMETRIC_TRANSIENT))).toBe("transient");
  });

  it("treats prompt-infrastructure and unrecognised codes as unknown", () => {
    expect(classifyBiometricFailure(nativeError(VAULT_UNAVAILABLE))).toBe("unknown");
    expect(classifyBiometricFailure(nativeError(BIOMETRIC_ERROR))).toBe("unknown");
    expect(classifyBiometricFailure(nativeError("SOMETHING_ELSE"))).toBe("unknown");
  });

  it("never classifies on the message", () => {
    // A message that names a code in prose is not a code. Only the bridge's
    // `code` slot is trusted.
    expect(classifyBiometricFailure(new Error("BIOMETRIC_LOCKOUT: too many"))).toBe("unknown");
    expect(classifyBiometricFailure(new Error("Biometric prompt error code 13: use password"))).toBe("unknown");
    // And a code wins over whatever the message says.
    expect(classifyBiometricFailure(nativeError(BIOMETRIC_CANCELLED, "BIOMETRIC_LOCKOUT: x"))).toBe("cancelled");
  });

  it("treats a missing code as unknown", () => {
    expect(classifyBiometricFailure(nativeError(null))).toBe("unknown");
    expect(classifyBiometricFailure(nativeError(undefined))).toBe("unknown");
    expect(classifyBiometricFailure(new Error("no code attached"))).toBe("unknown");
    expect(classifyBiometricFailure(undefined)).toBe("unknown");
    expect(classifyBiometricFailure("a bare string, not an Error")).toBe("unknown");
    expect(classifyBiometricFailure(null)).toBe("unknown");
  });

  it("never retries a decision the listener already made", () => {
    expect(shouldRetryBiometricUnlock(nativeError(BIOMETRIC_CANCELLED))).toBe(false);
    expect(shouldRetryBiometricUnlock(nativeError(BIOMETRIC_LOCKOUT))).toBe(false);
    expect(shouldRetryBiometricUnlock(nativeError(BIOMETRIC_UNAVAILABLE))).toBe(false);
    expect(shouldRetryBiometricUnlock(nativeError(VAULT_KEY_INVALID))).toBe(false);
    expect(shouldRetryBiometricUnlock(nativeError(BIOMETRIC_TRANSIENT))).toBe(true);
    expect(shouldRetryBiometricUnlock(nativeError(null))).toBe(true);
  });

  it("save retries only the Keystore warm-up failures", () => {
    expect(shouldRetryBiometricSave(nativeError(BIOMETRIC_TRANSIENT))).toBe(true);
    expect(shouldRetryBiometricSave(nativeError(VAULT_UNAVAILABLE))).toBe(true);
    expect(shouldRetryBiometricSave(nativeError(BIOMETRIC_CANCELLED))).toBe(false);
    expect(shouldRetryBiometricSave(nativeError(BIOMETRIC_LOCKOUT))).toBe(false);
    expect(shouldRetryBiometricSave(nativeError(VAULT_KEY_INVALID))).toBe(false);
    // Prose decides nothing: a message mentioning "timeout" is not a code.
    expect(shouldRetryBiometricSave(new Error("vault_unavailable: timeout"))).toBe(false);
    expect(shouldRetryBiometricSave(nativeError(null))).toBe(false);
    expect(shouldRetryBiometricSave(undefined)).toBe(false);
  });

  it("only discards a key that can never work again", () => {
    expect(shouldClearSavedKey("key-invalid")).toBe(true);
    for (const kind of ["cancelled", "lockout", "unavailable", "transient", "unknown"] as const) {
      expect(shouldClearSavedKey(kind)).toBe(false);
    }
  });

  it("stays silent when the listener cancelled", () => {
    expect(biometricFailureMessage("cancelled", copy)).toBeUndefined();
    expect(biometricFailureMessage("lockout", copy)).toBe(copy.locked);
    expect(biometricFailureMessage("key-invalid", copy)).toBe(copy.needsSetup);
    expect(biometricFailureMessage("transient", copy)).toBe(copy.failed);
  });
});
