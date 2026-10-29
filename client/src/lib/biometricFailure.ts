/**
 * Why a biometric prompt failed, and what to do about it (spec 28, phase 5;
 * spec 29).
 *
 * ## The bug this exists for
 *
 * The Keystore key that protects the saved device value is created with
 * `setInvalidatedByBiometricEnrollment(true)` (`BiometricVaultPlugin.java`).
 * Enrolling a *new* fingerprint therefore invalidates the key, while the
 * ciphertext stays in SharedPreferences. From then on the value can never be
 * decrypted, and `hasSavedValue()` still says `true`.
 *
 * The old code treated every failure the same: retry once, then report
 * "Fingerprint or face unlock didn't work. Use your password." Combined with an
 * unlock screen that had no way out, that is a permanent dead end -- neither
 * fingerprint nor password can succeed, and nothing on the screen is clickable.
 *
 * The table below is the fix: cancellation is not a failure, a lockout is not a
 * broken key, and only an unusable key gets thrown away.
 */

export type BiometricFailure =
  /** The listener dismissed the prompt or pressed "Use password". */
  | "cancelled"
  /** Too many failed attempts; nothing is wrong with the saved key. */
  | "lockout"
  /** No sensor, or nothing enrolled in Android. */
  | "unavailable"
  /** The OS hiccuped. One more attempt is reasonable. */
  | "transient"
  /** The saved value can never be opened again. Drop it. */
  | "key-invalid"
  /** Unrecognised. Fall back to the password without destroying anything. */
  | "unknown";

/**
 * androidx.biometric error codes, which the plugin passes through verbatim.
 *
 * Grouped by what the listener should experience, not by Android's naming:
 * three of these ("cancelled", "negative button", "user cancelled") are all
 * "the listener chose the password", and treating them as failures is how the
 * prompt reappeared after someone had already declined it.
 */
const CANCELLED_CODES = [5, 10, 13];
const LOCKOUT_CODES = [7, 9];
const UNAVAILABLE_CODES = [1, 11, 12];
const TRANSIENT_CODES = [2, 3, 8];

const NATIVE_CODE = /biometric prompt error code\s+(\d+)/i;

export function classifyBiometricFailure(error: unknown): BiometricFailure {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const lower = message.toLowerCase();

  // Stable codes from the native side. These survive message rewrites.
  if (lower.includes("vault_key_invalid")) return "key-invalid";
  if (lower.includes("vault_unavailable")) return "unknown";
  if (lower.includes("biometric_cancelled")) return "cancelled";
  if (lower.includes("biometric_lockout")) return "lockout";
  if (lower.includes("biometric_unavailable")) return "unavailable";
  if (lower.includes("biometric_transient")) return "transient";

  const nativeCode = message.match(NATIVE_CODE);
  if (nativeCode) {
    const code = Number(nativeCode[1]);
    if (CANCELLED_CODES.includes(code)) return "cancelled";
    if (LOCKOUT_CODES.includes(code)) return "lockout";
    if (UNAVAILABLE_CODES.includes(code)) return "unavailable";
    if (TRANSIENT_CODES.includes(code)) return "transient";
    return "unknown";
  }

  // Builds before the stable codes: `unlock` reports a Keystore failure as
  // "Biometric vault unavailable" -- the key is gone, not the sensor.
  if (lower.includes("biometric vault unavailable")) return "key-invalid";
  if (lower.includes("biometric check failed")) return "key-invalid";
  if (lower.includes("no biometric unlock is set up")) return "unknown";
  if (/cancel/i.test(message)) return "cancelled";

  return "unknown";
}

/**
 * Whether trying the prompt a second time is worth it.
 *
 * Only a transient OS failure is retried. Cancelling must never re-open the
 * prompt -- that is the first-press bug's mirror image, and it is what made the
 * fingerprint button feel broken.
 */
export function shouldRetryBiometricUnlock(error: unknown): boolean {
  const kind = classifyBiometricFailure(error);
  return kind === "transient" || kind === "unknown";
}

/** Whether the saved value must be discarded so the device can be set up again. */
export function shouldClearSavedKey(failure: BiometricFailure): boolean {
  return failure === "key-invalid";
}

/** The listener-facing sentence for a failure, or undefined when it is silent. */
export function biometricFailureMessage(
  failure: BiometricFailure,
  messages: { failed: string; locked: string; needsSetup: string },
): string | undefined {
  switch (failure) {
    case "cancelled":
      return undefined;
    case "lockout":
      return messages.locked;
    case "key-invalid":
      return messages.needsSetup;
    default:
      return messages.failed;
  }
}
