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
    } catch (error) {
      console.error(`[BiometricVault] Clear failed for profile ${profileId}:`, error);
      throw error;
    }
  },
};
