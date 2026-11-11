import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// A rejection shaped like Capacitor delivers it: the stable taxonomy code is
// on `.code`; the message is for humans and must not decide behaviour.
function nativeError(code: string, message = "biometry"): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

// The Vault lives on the bridge's own registry, not on a module import —
// which is the whole point of the fix. Mock the bridge, not a plugin module.
const mockVault = {
  isAvailable: vi.fn(),
  hasSavedValue: vi.fn(),
  save: vi.fn(),
  unlock: vi.fn(),
  clear: vi.fn(),
};

vi.mock("./platform", () => ({
  isNativeShell: () => true,
}));

vi.mock("../copy", () => ({
  copy: {
    security: {
      vaultPromptTitle: "Test Title",
      vaultPromptSubtitle: "Test Subtitle",
      vaultPromptCancel: "Cancel",
    },
    errors: {
      bridgeNotReady: "Bridge not ready",
    },
  },
}));

// Import after mocks are set up
const { biometricVault } = await import("./biometricVault");

describe("biometricVault", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as { Capacitor?: unknown }).Capacitor = {
      Plugins: { BiometricVault: mockVault },
    };
    // Clear console mocks
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    delete (globalThis as { Capacitor?: unknown }).Capacitor;
    vi.restoreAllMocks();
  });

  describe("hasSavedValue", () => {
    it("should pass profileId to native plugin", async () => {
      mockVault.hasSavedValue.mockResolvedValue({ saved: true });
      
      await biometricVault.hasSavedValue(4);
      
      expect(mockVault.hasSavedValue).toHaveBeenCalledWith({ profileId: 4 });
    });

    it("should handle errors gracefully", async () => {
      mockVault.hasSavedValue.mockRejectedValue(new Error("Test error"));
      
      const result = await biometricVault.hasSavedValue(4);
      
      expect(result).toBe(false);
      expect(console.error).toHaveBeenCalledWith(
        "[BiometricVault] Has saved value check failed for profile 4:",
        expect.any(Error)
      );
    });
  });

  describe("save", () => {
    it("should pass profileId and payload to native plugin", async () => {
      mockVault.save.mockResolvedValue(undefined);
      
      const payload = { profileId: 4, key: "test-key" };
      await biometricVault.save(4, payload);
      
      expect(mockVault.save).toHaveBeenCalledWith({
        profileId: 4,
        payload: JSON.stringify(payload),
        title: "Test Title",
        subtitle: "Test Subtitle",
        cancel: "Cancel",
      });
    });

    it("should retry on VAULT_UNAVAILABLE, the Keystore warm-up failure", async () => {
      mockVault.save
        .mockRejectedValueOnce(nativeError("VAULT_UNAVAILABLE", "Biometric vault is unavailable"))
        .mockResolvedValueOnce(undefined);
      
      await biometricVault.save(4, { profileId: 4, key: "test" });
      
      expect(mockVault.save).toHaveBeenCalledTimes(2);
      expect(console.log).toHaveBeenCalledWith(
        "[BiometricVault] Transient error on save attempt 1, retrying..."
      );
    });

    it("should retry on a transient OS failure", async () => {
      mockVault.save
        .mockRejectedValueOnce(nativeError("BIOMETRIC_TRANSIENT", "sensor timed out"))
        .mockResolvedValueOnce(undefined);
      
      await biometricVault.save(4, { profileId: 4, key: "test" });
      
      expect(mockVault.save).toHaveBeenCalledTimes(2);
    });

    it("should not retry on non-transient errors", async () => {
      mockVault.save.mockRejectedValue(nativeError("BIOMETRIC_CANCELLED", "cancelled"));
      
      await expect(biometricVault.save(4, { profileId: 4, key: "test" })).rejects.toThrow();
      
      expect(mockVault.save).toHaveBeenCalledTimes(1);
    });

    it("should not retry a plain error with no code at all", async () => {
      // Prose is not a contract: a message that merely mentions
      // "vault_unavailable" or "timeout" decides nothing.
      mockVault.save.mockRejectedValue(new Error("VAULT_UNAVAILABLE: timeout occurred"));
      
      await expect(biometricVault.save(4, { profileId: 4, key: "test" })).rejects.toThrow();
      
      expect(mockVault.save).toHaveBeenCalledTimes(1);
    });

    it("should fail after 2 attempts with transient error", async () => {
      mockVault.save.mockRejectedValue(nativeError("VAULT_UNAVAILABLE", "Keystore warming up"));
      
      await expect(biometricVault.save(4, { profileId: 4, key: "test" })).rejects.toThrow();
      
      expect(mockVault.save).toHaveBeenCalledTimes(2);
    });

    it("should log detailed error on failure", async () => {
      const error = new Error("Test error");
      mockVault.save.mockRejectedValue(error);
      
      await expect(biometricVault.save(4, { profileId: 4, key: "test" })).rejects.toThrow();
      
      expect(console.error).toHaveBeenCalledWith(
        "[BiometricVault] Save failed for profile 4:",
        error
      );
    });
  });

  describe("unlock", () => {
    it("should pass profileId to native plugin", async () => {
      mockVault.unlock.mockResolvedValue({ payload: JSON.stringify({ profileId: 4, key: "test" }) });
      
      await biometricVault.unlock<{ profileId: number; key: string }>(4);
      
      expect(mockVault.unlock).toHaveBeenCalledWith({
        profileId: 4,
        title: "Test Title",
        subtitle: "Test Subtitle",
        cancel: "Cancel",
      });
    });

    it("should parse and return the payload", async () => {
      const payload = { profileId: 4, key: "test-key", secret: "test-secret" };
      mockVault.unlock.mockResolvedValue({ payload: JSON.stringify(payload) });
      
      const result = await biometricVault.unlock<typeof payload>(4);
      
      expect(result).toEqual(payload);
    });

    it("should throw on unlock error", async () => {
      mockVault.unlock.mockRejectedValue(nativeError("VAULT_KEY_INVALID", "Biometric vault could not be opened"));
      
      await expect(biometricVault.unlock(4)).rejects.toThrow("Biometric vault could not be opened");
      
      expect(console.error).toHaveBeenCalledWith(
        "[BiometricVault] Unlock failed for profile 4:",
        expect.any(Error)
      );
    });
  });

  describe("clear", () => {
    it("should pass profileId to native plugin", async () => {
      mockVault.clear.mockResolvedValue(undefined);
      
      await biometricVault.clear(4);
      
      expect(mockVault.clear).toHaveBeenCalledWith({ profileId: 4 });
    });

    it("should handle clear errors gracefully", async () => {
      mockVault.clear.mockRejectedValue(new Error("Test error"));
      
      await expect(biometricVault.clear(4)).rejects.toThrow();
      
      expect(console.error).toHaveBeenCalledWith(
        "[BiometricVault] Clear failed for profile 4:",
        expect.any(Error)
      );
    });

    it("should log success on clear", async () => {
      mockVault.clear.mockResolvedValue(undefined);
      
      await biometricVault.clear(4);
      
      expect(console.log).toHaveBeenCalledWith("[BiometricVault] Clear successful for profile 4");
    });
  });

  describe("hasSecret", () => {
    it("is false for a value that was saved without a secret", async () => {
      mockVault.save.mockResolvedValue(undefined);
      window.localStorage.clear();

      await biometricVault.save(4, { profileId: 4, key: "key-only" });

      expect(biometricVault.hasSecret(4)).toBe(false);
    });

    it("is true once a value with a secret is saved", async () => {
      mockVault.save.mockResolvedValue(undefined);
      window.localStorage.clear();

      await biometricVault.save(4, { profileId: 4, secret: "shh", key: "key" });

      expect(biometricVault.hasSecret(4)).toBe(true);
    });

    it("is false again after the value is cleared", async () => {
      mockVault.save.mockResolvedValue(undefined);
      mockVault.clear.mockResolvedValue(undefined);
      window.localStorage.clear();

      await biometricVault.save(4, { profileId: 4, secret: "shh", key: "key" });
      await biometricVault.clear(4);

      expect(biometricVault.hasSecret(4)).toBe(false);
    });

    it("keeps one profile's answer out of another's", async () => {
      mockVault.save.mockResolvedValue(undefined);
      window.localStorage.clear();

      await biometricVault.save(4, { profileId: 4, secret: "shh", key: "key" });

      expect(biometricVault.hasSecret(4)).toBe(true);
      expect(biometricVault.hasSecret(5)).toBe(false);
    });
  });

  describe("per-profile isolation", () => {
    it("should handle multiple profiles independently", async () => {
      mockVault.hasSavedValue.mockImplementation(({ profileId }) => 
        Promise.resolve({ saved: profileId === 4 })
      );
      
      const profile4 = await biometricVault.hasSavedValue(4);
      const profile5 = await biometricVault.hasSavedValue(5);
      
      expect(profile4).toBe(true);
      expect(profile5).toBe(false);
      expect(mockVault.hasSavedValue).toHaveBeenCalledTimes(2);
    });

    it("should save different data for different profiles", async () => {
      mockVault.save.mockResolvedValue(undefined);
      
      await biometricVault.save(4, { profileId: 4, key: "key4" });
      await biometricVault.save(5, { profileId: 5, key: "key5" });
      
      expect(mockVault.save).toHaveBeenNthCalledWith(1, expect.objectContaining({
        profileId: 4,
        payload: expect.stringContaining("key4"),
      }));
      expect(mockVault.save).toHaveBeenNthCalledWith(2, expect.objectContaining({
        profileId: 5,
        payload: expect.stringContaining("key5"),
      }));
    });
  });
});
