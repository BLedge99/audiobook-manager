import { registerPlugin } from "@capacitor/core";
import { isNativeShell } from "./platform";
import { copy } from "../copy";

interface BiometricVaultPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  hasSavedValue(options: { profileId: number }): Promise<{ saved: boolean }>;
  save(options: { profileId: number; payload: string; title: string; subtitle: string; cancel: string }): Promise<void>;
  unlock(options: { profileId: number; title: string; subtitle: string; cancel: string }): Promise<{ payload: string }>;
  clear(options: { profileId: number }): Promise<void>;
}

const vault = registerPlugin<BiometricVaultPlugin>("BiometricVault");

/**
 * Whether the Vault holds a value that carries a device secret.
 *
 * ## Why a marker is needed
 *
 * The Vault stores ciphertext, so the client cannot read its own saved value
 * without unlocking it. But it does need to know one thing about it: whether
 * the value carries the **device secret**, which is what lets the phone sign
 * in without a password.
 *
 * It matters because the two halves of the setup can fall out of step. The
 * Keystore key is invalidated when a new fingerprint is enrolled, and the
 * saved value is then cleared -- while the server's credential survives. The
 * app used to decide "biometrics are set up" from the *server's* answer,
 * which stayed true after the Vault was emptied, so the phone could never be
 * set up again and every attempt added another credential.
 *
 * So the app records what it put in the Vault. The marker is not a secret and
 * nothing is authorised with it; it only says "this phone has a saved value
 * that can sign in on its own".
 */
const SECRET_MARKER_PREFIX = "deviceSecret:";

function secretMarkerKey(profileId: number): string {
  return `${SECRET_MARKER_PREFIX}${profileId}`;
}

function readSecretMarker(profileId: number): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(secretMarkerKey(profileId)) === "1";
  } catch {
    return false;
  }
}

function writeSecretMarker(profileId: number, present: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (present) window.localStorage.setItem(secretMarkerKey(profileId), "1");
    else window.localStorage.removeItem(secretMarkerKey(profileId));
  } catch {
    // Private mode / storage disabled. The Vault itself still works; only the
    // hint about its contents is lost.
  }
}

export const biometricVault = {
  supported: isNativeShell,
  async available(): Promise<boolean> {
    if (!isNativeShell()) {
      console.log("[BiometricVault] Not available: not a native shell");
      return false;
    }
    try {
      const result = await vault.isAvailable();
      console.log("[BiometricVault] Available check result:", result.available);
      return result.available;
    } catch (error) {
      console.error("[BiometricVault] Available check failed:", error);
      return false;
    }
  },
  async hasSavedValue(profileId: number): Promise<boolean> {
    if (!isNativeShell()) {
      console.log("[BiometricVault] Has saved value: not a native shell");
      return false;
    }
    try {
      const result = await vault.hasSavedValue({ profileId });
      console.log(`[BiometricVault] Has saved value for profile ${profileId}:`, result.saved);
      return result.saved;
    } catch (error) {
      console.error(`[BiometricVault] Has saved value check failed for profile ${profileId}:`, error);
      return false;
    }
  },
  /**
   * Whether the saved value carries a device secret.
   *
   * False when nothing is saved, and false when what is saved was enrolled
   * offline -- an offline enrolment has no secret, because there was no
   * server to ask.
   */
  hasSecret(profileId: number): boolean {
    return readSecretMarker(profileId);
  },
  async save(profileId: number, payload: unknown): Promise<void> {
    console.log(`[BiometricVault] Saving value for profile ${profileId}...`);

    // Retry logic: first attempt can fail transiently while sensor/Keystore warms up
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await vault.save({
          profileId,
          payload: JSON.stringify(payload),
          title: copy.security.vaultPromptTitle,
          subtitle: copy.security.vaultPromptSubtitle,
          cancel: copy.security.vaultPromptCancel,
        });
        console.log(`[BiometricVault] Save successful for profile ${profileId}`);
        // Record what was actually written: a value without a secret cannot
        // sign in on its own.
        writeSecretMarker(
          profileId,
          Boolean((payload as { secret?: unknown } | null)?.secret),
        );
        return;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
        const isTransient = errorMsg.includes('vault_unavailable') ||
                           errorMsg.includes('transient') ||
                           errorMsg.includes('timeout');

        if (attempt === 0 && isTransient) {
          console.log(`[BiometricVault] Transient error on save attempt ${attempt + 1}, retrying...`);
          continue;
        }

        console.error(`[BiometricVault] Save failed for profile ${profileId}:`, error);
        throw error;
      }
    }
  },
  async unlock<T>(profileId: number): Promise<T> {
    console.log(`[BiometricVault] Unlocking for profile ${profileId}...`);
    try {
      const result = await vault.unlock({
        profileId,
        title: copy.security.vaultPromptTitle,
        subtitle: copy.security.vaultPromptSubtitle,
        cancel: copy.security.vaultPromptCancel
      });
      console.log(`[BiometricVault] Unlock successful for profile ${profileId}`);
      return JSON.parse(result.payload) as T;
    } catch (error) {
      console.error(`[BiometricVault] Unlock failed for profile ${profileId}:`, error);
      throw error;
    }
  },
  async clear(profileId: number): Promise<void> {
    console.log(`[BiometricVault] Clearing for profile ${profileId}...`);
    try {
      await vault.clear({ profileId });
      console.log(`[BiometricVault] Clear successful for profile ${profileId}`);
      // The value is gone, so it cannot carry a secret any more.
      writeSecretMarker(profileId, false);
    } catch (error) {
      console.error(`[BiometricVault] Clear failed for profile ${profileId}:`, error);
      throw error;
    }
  },
};
