import { describe, expect, it } from "vitest";
import {
  biometricFailureMessage,
  classifyBiometricFailure,
  shouldClearSavedKey,
  shouldRetryBiometricUnlock,
} from "./biometricFailure";

/**
 * Spec 29. The classification table behind the fingerprint lifecycle.
 *
 * The real bug this covers: pressing "Use password" (androidx code 13) used to
 * be retried, so the prompt re-opened after the listener had declined it, and a
 * Keystore key invalidated by a new fingerprint enrolment was reported as a
 * generic failure with no way forward.
 */

const copy = {
  failed: "Fingerprint or face unlock didn't work. Use your password.",
  locked: "Too many tries with fingerprint or face. Wait a moment, or sign in with your password.",
  needsSetup:
    "Device sign-in no longer works on this phone. Sign in with your password, then set it up again in Settings.",
};

describe("classifying a biometric failure", () => {
  it("treats every cancellation code as a choice, not a failure", () => {
    for (const code of [5, 10, 13]) {
      expect(classifyBiometricFailure(new Error(`Biometric prompt error code ${code}: cancelled`))).toBe(
        "cancelled",
      );
    }
  });

  it("treats a lockout as a wait, not a broken key", () => {
    for (const code of [7, 9]) {
      expect(classifyBiometricFailure(new Error(`Biometric prompt error code ${code}: too many`))).toBe(
        "lockout",
      );
    }
  });

  it("treats missing hardware or no enrolment as unavailable", () => {
    for (const code of [1, 11, 12]) {
      expect(
        classifyBiometricFailure(new Error(`Biometric prompt error code ${code}: none`)),
      ).toBe("unavailable");
    }
  });

  it("retries only a transient OS failure", () => {
    for (const code of [2, 3, 8]) {
      expect(classifyBiometricFailure(new Error(`Biometric prompt error code ${code}: try again`))).toBe(
        "transient",
      );
    }
  });

  it("reads the stable codes the plugin now sends", () => {
    expect(classifyBiometricFailure(new Error("VAULT_KEY_INVALID: key invalidated"))).toBe(
      "key-invalid",
    );
    expect(classifyBiometricFailure(new Error("BIOMETRIC_NEGATIVE"))).toBe("unknown");
    expect(classifyBiometricFailure(new Error("BIOMETRIC_CANCELLED: dismissed"))).toBe("cancelled");
    expect(classifyBiometricFailure(new Error("BIOMETRIC_LOCKOUT: too many"))).toBe("lockout");
    expect(classifyBiometricFailure(new Error("BIOMETRIC_UNAVAILABLE: none"))).toBe("unavailable");
    expect(classifyBiometricFailure(new Error("BIOMETRIC_TRANSIENT: vendor"))).toBe("transient");
  });

  it("reads the older plugin's Keystore failure as an unusable key", () => {
    // The shipped APK before this change reports an invalidated Keystore key
    // this way, and it is the case that must clear the saved value.
    expect(classifyBiometricFailure(new Error("Biometric vault unavailable"))).toBe("key-invalid");
    expect(classifyBiometricFailure(new Error("Biometric check failed"))).toBe("key-invalid");
  });

  it("does not guess at an unknown error", () => {
    expect(classifyBiometricFailure(new Error("something else"))).toBe("unknown");
    expect(classifyBiometricFailure(undefined)).toBe("unknown");
  });

  it("never retries a decision the listener already made", () => {
    expect(shouldRetryBiometricUnlock(new Error("Biometric prompt error code 13: use password"))).toBe(
      false,
    );
    expect(shouldRetryBiometricUnlock(new Error("Biometric prompt error code 10: cancelled"))).toBe(
      false,
    );
    expect(shouldRetryBiometricUnlock(new Error("Biometric prompt error code 7: lockout"))).toBe(false);
    expect(shouldRetryBiometricUnlock(new Error("Biometric prompt error code 12: no hardware"))).toBe(
      false,
    );
    expect(shouldRetryBiometricUnlock(new Error("Biometric prompt error code 3: timeout"))).toBe(true);
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
