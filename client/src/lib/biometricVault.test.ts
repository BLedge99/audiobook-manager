import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Capacitor plugin - must be defined before import
const mockVault = {
  isAvailable: vi.fn(),
  hasSavedValue: vi.fn(),
  save: vi.fn(),
  unlock: vi.fn(),
  clear: vi.fn(),
};

vi.mock("@capacitor/core", () => ({
  registerPlugin: () => mockVault,
}));

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
  },
}));

// Import after mocks are set up
const { biometricVault } = await import("./biometricVault");

describe("biometricVault", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear console mocks
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
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

    it("should retry on transient VAULT_UNAVAILABLE error", async () => {
      mockVault.save
        .mockRejectedValueOnce(new Error("VAULT_UNAVAILABLE: Biometric vault unavailable"))
        .mockResolvedValueOnce(undefined);
      
      await biometricVault.save(4, { profileId: 4, key: "test" });
      
      expect(mockVault.save).toHaveBeenCalledTimes(2);
      expect(console.log).toHaveBeenCalledWith(
        "[BiometricVault] Transient error on save attempt 1, retrying..."
      );
    });

    it("should retry on transient timeout error", async () => {
      mockVault.save
        .mockRejectedValueOnce(new Error("timeout occurred"))
        .mockResolvedValueOnce(undefined);
      
      await biometricVault.save(4, { profileId: 4, key: "test" });
      
      expect(mockVault.save).toHaveBeenCalledTimes(2);
    });

    it("should not retry on non-transient errors", async () => {
      mockVault.save.mockRejectedValue(new Error("BIOMETRIC_CANCELLED"));
      
      await expect(biometricVault.save(4, { profileId: 4, key: "test" })).rejects.toThrow();
      
      expect(mockVault.save).toHaveBeenCalledTimes(1);
    });

    it("should fail after 2 attempts with transient error", async () => {
      mockVault.save.mockRejectedValue(new Error("VAULT_UNAVAILABLE: transient error"));
      
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
      mockVault.unlock.mockRejectedValue(new Error("VAULT_KEY_INVALID"));
      
      await expect(biometricVault.unlock(4)).rejects.toThrow("VAULT_KEY_INVALID");
      
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
