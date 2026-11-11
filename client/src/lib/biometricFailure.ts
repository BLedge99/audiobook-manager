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
 * ## The contract with the native side
 *
 * `BiometricVaultPlugin.java` rejects every call with a stable `code` in
 * PluginCall's code slot; Capacitor's bridge copies it onto the rejected
 * Error as `error.code`. The constants below are that contract, shared
 * verbatim with the Java plugin -- change both sides together.
 *
 * The client classifies on the code and never on the message. The message is
 * for humans (logs, diagnostics); matching on it -- including a former regex
 * over the sentence "biometric prompt error code N" -- is how a translated or
 * reworded string once decided whether a phone could discard a saved key.
 * A rejection without a code, or with a code neither side knows, classifies
 * as "unknown" and destroys nothing.
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

/** Stable codes, shared verbatim with `BiometricVaultPlugin.java`. */
export const VAULT_KEY_INVALID = "VAULT_KEY_INVALID";
export const VAULT_UNAVAILABLE = "VAULT_UNAVAILABLE";
export const BIOMETRIC_CANCELLED = "BIOMETRIC_CANCELLED";
export const BIOMETRIC_LOCKOUT = "BIOMETRIC_LOCKOUT";
export const BIOMETRIC_UNAVAILABLE = "BIOMETRIC_UNAVAILABLE";
export const BIOMETRIC_TRANSIENT = "BIOMETRIC_TRANSIENT";
export const BIOMETRIC_ERROR = "BIOMETRIC_ERROR";

/** The code the native side rejected with, or null when there is none. */
function codeOf(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.length > 0 ? code : null;
}

export function classifyBiometricFailure(error: unknown): BiometricFailure {
  switch (codeOf(error)) {
    case VAULT_KEY_INVALID:
      return "key-invalid";
    case BIOMETRIC_CANCELLED:
      return "cancelled";
    case BIOMETRIC_LOCKOUT:
      return "lockout";
    case BIOMETRIC_UNAVAILABLE:
      return "unavailable";
    case BIOMETRIC_TRANSIENT:
      return "transient";
    default:
      // VAULT_UNAVAILABLE (save-time / prompt-infrastructure), BIOMETRIC_ERROR,
      // an unknown code, or no code: ambiguous, so act like "unknown".
      return "unknown";
  }
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

/**
 * Whether a save is worth one retry.
 *
 * The first Keystore write after boot can fail while the sensor warms up,
 * which is the only failure the save path retries. A cancellation is never
 * retried either way: pressing "Use password" must not re-open the prompt
 * (spec 29), and only the taxonomy code may decide that here.
 */
export function shouldRetryBiometricSave(error: unknown): boolean {
  const code = codeOf(error);
  return code === BIOMETRIC_TRANSIENT || code === VAULT_UNAVAILABLE;
}

/** Whether the saved value must be discarded so the device can be set up again. */
export function shouldClearSavedKey(failure: BiometricFailure): boolean {
  return failure === "key-invalid";
}

/** The listener-facing sentence for a failure, or undefined when it is silent. */
export function biometricFailureMessage(
  failure: BiometricFailure,
  messages: {
    failed: string;
    locked: string;
    needsSetup: string;
    unavailable?: string;
    transient?: string;
  },
): string | undefined {
  switch (failure) {
    case "cancelled":
      return undefined;
    case "lockout":
      return messages.locked;
    case "key-invalid":
      return messages.needsSetup;
    case "unavailable":
      return messages.unavailable || messages.failed;
    case "transient":
      return messages.transient || messages.failed;
    default:
      return messages.failed;
  }
}
