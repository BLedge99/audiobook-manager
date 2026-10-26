import { registerPlugin } from "@capacitor/core";
import { isNativeShell } from "./platform";
import { copy } from "../copy";

interface BiometricVaultPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  hasSavedValue(): Promise<{ saved: boolean }>;
  save(options: { payload: string; title: string; subtitle: string; cancel: string }): Promise<void>;
  unlock(options: { title: string; subtitle: string; cancel: string }): Promise<{ payload: string }>;
  clear(): Promise<void>;
}

const vault = registerPlugin<BiometricVaultPlugin>("BiometricVault");

export const biometricVault = {
  supported: isNativeShell,
  async available(): Promise<boolean> {
    if (!isNativeShell()) return false;
    try { return (await vault.isAvailable()).available; } catch { return false; }
  },
  async hasSavedValue(): Promise<boolean> {
    if (!isNativeShell()) return false;
    try { return (await vault.hasSavedValue()).saved; } catch { return false; }
  },
  save: (payload: unknown) => vault.save({
    payload: JSON.stringify(payload), title: copy.security.vaultPromptTitle,
    subtitle: copy.security.vaultPromptSubtitle, cancel: copy.security.vaultPromptCancel,
  }),
  async unlock<T>(): Promise<T> {
    const result = await vault.unlock({ title: copy.security.vaultPromptTitle,
      subtitle: copy.security.vaultPromptSubtitle, cancel: copy.security.vaultPromptCancel });
    return JSON.parse(result.payload) as T;
  },
  clear: () => vault.clear(),
};
