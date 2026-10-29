import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OfflineUnlock } from "./OfflineUnlock";

// Mock dependencies
const mockBiometricVault = {
  hasSavedValue: vi.fn(),
  unlock: vi.fn(),
  clear: vi.fn(),
};

const mockUnlockProfileCacheWithKey = vi.fn();
const mockFromBase64 = vi.fn();

vi.mock("../lib/biometricVault", () => ({
  biometricVault: mockBiometricVault,
}));

vi.mock("../local/privateCache", () => ({
  unlockProfileCacheWithKey: (...args: unknown[]) => mockUnlockProfileCacheWithKey(...args),
  fromBase64: (...args: unknown[]) => mockFromBase64(...args),
}));

describe("OfflineUnlock", () => {
  const mockOnUnlocked = vi.fn();
  const mockOnChangeServer = vi.fn();
  const mockOnListenWithoutProgress = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.setItem("profileId", "4");
    mockFromBase64.mockReturnValue(new Uint8Array([1, 2, 3]));
  });

  describe("biometric unlock button visibility", () => {
    it("should show fingerprint button when biometric data saved for profile", async () => {
      mockBiometricVault.hasSavedValue.mockResolvedValue(true);

      render(
        <OfflineUnlock
          onUnlocked={mockOnUnlocked}
          onChangeServer={mockOnChangeServer}
          onListenWithoutProgress={mockOnListenWithoutProgress}
        />
      );

      await waitFor(() => {
        expect(screen.getByText(/unlock with fingerprint or face/i)).toBeInTheDocument();
      });
    });

    it("should not show fingerprint button when no biometric data", async () => {
      mockBiometricVault.hasSavedValue.mockResolvedValue(false);

      render(
        <OfflineUnlock
          onUnlocked={mockOnUnlocked}
          onChangeServer={mockOnChangeServer}
          onListenWithoutProgress={mockOnListenWithoutProgress}
        />
      );

      await waitFor(() => {
        expect(screen.queryByText(/unlock with fingerprint or face/i)).not.toBeInTheDocument();
      });
    });

    it("should check biometric data for correct profile", async () => {
      window.localStorage.setItem("profileId", "5");
      mockBiometricVault.hasSavedValue.mockResolvedValue(true);

      render(
        <OfflineUnlock
          onUnlocked={mockOnUnlocked}
          onChangeServer={mockOnChangeServer}
          onListenWithoutProgress={mockOnListenWithoutProgress}
        />
      );

      await waitFor(() => {
        expect(mockBiometricVault.hasSavedValue).toHaveBeenCalledWith(5);
      });
    });
  });

  describe("successful biometric unlock", () => {
    it("should unlock with offline-only format (no secret)", async () => {
      mockBiometricVault.hasSavedValue.mockResolvedValue(true);
      mockBiometricVault.unlock.mockResolvedValue({
        profileId: 4,
        key: "AQID",
      });
      mockUnlockProfileCacheWithKey.mockResolvedValue(undefined);

      render(
        <OfflineUnlock
          onUnlocked={mockOnUnlocked}
          onChangeServer={mockOnChangeServer}
          onListenWithoutProgress={mockOnListenWithoutProgress}
        />
      );

      const unlockButton = await screen.findByText(/unlock with fingerprint or face/i);
      await userEvent.click(unlockButton);

      await waitFor(() => {
        expect(mockBiometricVault.unlock).toHaveBeenCalledWith(4);
        expect(mockUnlockProfileCacheWithKey).toHaveBeenCalledWith(4, expect.any(Uint8Array));
        expect(mockOnUnlocked).toHaveBeenCalled();
      });
    });

    it("should unlock with online-registered format (with secret)", async () => {
      mockBiometricVault.hasSavedValue.mockResolvedValue(true);
      mockBiometricVault.unlock.mockResolvedValue({
        profileId: 4,
        key: "AQID",
        secret: "secret-123",
      });
      mockUnlockProfileCacheWithKey.mockResolvedValue(undefined);

      render(
        <OfflineUnlock
          onUnlocked={mockOnUnlocked}
          onChangeServer={mockOnChangeServer}
          onListenWithoutProgress={mockOnListenWithoutProgress}
        />
      );

      const unlockButton = await screen.findByText(/unlock with fingerprint or face/i);
      await userEvent.click(unlockButton);

      await waitFor(() => {
        expect(mockBiometricVault.unlock).toHaveBeenCalledWith(4);
        expect(mockUnlockProfileCacheWithKey).toHaveBeenCalledWith(4, expect.any(Uint8Array));
        expect(mockOnUnlocked).toHaveBeenCalled();
      });
    });

    it("should retry once on transient failure", async () => {
      mockBiometricVault.hasSavedValue.mockResolvedValue(true);
      mockBiometricVault.unlock
        .mockRejectedValueOnce(new Error("BIOMETRIC_TRANSIENT: timeout"))
        .mockResolvedValueOnce({ profileId: 4, key: "AQID" });
      mockUnlockProfileCacheWithKey.mockResolvedValue(undefined);

      render(
        <OfflineUnlock
          onUnlocked={mockOnUnlocked}
          onChangeServer={mockOnChangeServer}
          onListenWithoutProgress={mockOnListenWithoutProgress}
        />
      );

      const unlockButton = await screen.findByText(/unlock with fingerprint or face/i);
      await userEvent.click(unlockButton);

      await waitFor(() => {
        expect(mockBiometricVault.unlock).toHaveBeenCalledTimes(2);
        expect(mockOnUnlocked).toHaveBeenCalled();
      });
    });
  });

  describe("biometric unlock errors", () => {
    beforeEach(() => {
      mockBiometricVault.hasSavedValue.mockResolvedValue(true);
    });

    it("should show error on key invalidation and clear biometric data", async () => {
      mockBiometricVault.unlock.mockRejectedValue(
        new Error("VAULT_KEY_INVALID: Biometric vault unavailable")
      );
      mockBiometricVault.clear.mockResolvedValue(undefined);

      render(
        <OfflineUnlock
          onUnlocked={mockOnUnlocked}
          onChangeServer={mockOnChangeServer}
          onListenWithoutProgress={mockOnListenWithoutProgress}
        />
      );

      const unlockButton = await screen.findByText(/unlock with fingerprint or face/i);
      await userEvent.click(unlockButton);

      await waitFor(() => {
        expect(mockBiometricVault.clear).toHaveBeenCalledWith(4);
        expect(screen.getByText(/device sign-in no longer works/i)).toBeInTheDocument();
      });

      // Button should disappear after key invalidation
      await waitFor(() => {
        expect(screen.queryByText(/unlock with fingerprint or face/i)).not.toBeInTheDocument();
      });
    });

    it("should show specific error on lockout", async () => {
      mockBiometricVault.unlock.mockRejectedValue(
        new Error("BIOMETRIC_LOCKOUT: Too many attempts")
      );

      render(
        <OfflineUnlock
          onUnlocked={mockOnUnlocked}
          onChangeServer={mockOnChangeServer}
          onListenWithoutProgress={mockOnListenWithoutProgress}
        />
      );

      const unlockButton = await screen.findByText(/unlock with fingerprint or face/i);
      await userEvent.click(unlockButton);

      await waitFor(() => {
        expect(screen.getByText(/too many tries/i)).toBeInTheDocument();
      });
    });

    it("should show specific error when sensor unavailable", async () => {
      mockBiometricVault.unlock.mockRejectedValue(
        new Error("BIOMETRIC_UNAVAILABLE: No sensor")
      );

      render(
        <OfflineUnlock
          onUnlocked={mockOnUnlocked}
          onChangeServer={mockOnChangeServer}
          onListenWithoutProgress={mockOnListenWithoutProgress}
        />
      );

      const unlockButton = await screen.findByText(/unlock with fingerprint or face/i);
      await userEvent.click(unlockButton);

      await waitFor(() => {
        expect(screen.getByText(/biometric sensor is not available/i)).toBeInTheDocument();
      });
    });

    it("should show specific error on transient failure", async () => {
      mockBiometricVault.unlock.mockRejectedValue(
        new Error("BIOMETRIC_TRANSIENT: timeout")
      );

      render(
        <OfflineUnlock
          onUnlocked={mockOnUnlocked}
          onChangeServer={mockOnChangeServer}
          onListenWithoutProgress={mockOnListenWithoutProgress}
        />
      );

      const unlockButton = await screen.findByText(/unlock with fingerprint or face/i);
      await userEvent.click(unlockButton);

      await waitFor(() => {
        expect(screen.getByText(/biometric sensor is not responding/i)).toBeInTheDocument();
      });
    });

    it("should not show error on cancellation", async () => {
      mockBiometricVault.unlock.mockRejectedValue(
        new Error("BIOMETRIC_CANCELLED: User cancelled")
      );

      render(
        <OfflineUnlock
          onUnlocked={mockOnUnlocked}
          onChangeServer={mockOnChangeServer}
          onListenWithoutProgress={mockOnListenWithoutProgress}
        />
      );

      const unlockButton = await screen.findByText(/unlock with fingerprint or face/i);
      await userEvent.click(unlockButton);

      await waitFor(() => {
        expect(mockBiometricVault.unlock).toHaveBeenCalled();
      });

      // No error should be shown
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("should reject wrong profile data", async () => {
      mockBiometricVault.unlock.mockResolvedValue({
        profileId: 5, // Different profile
        key: "AQID",
      });

      render(
        <OfflineUnlock
          onUnlocked={mockOnUnlocked}
          onChangeServer={mockOnChangeServer}
          onListenWithoutProgress={mockOnListenWithoutProgress}
        />
      );

      const unlockButton = await screen.findByText(/unlock with fingerprint or face/i);
      await userEvent.click(unlockButton);

      await waitFor(() => {
        expect(screen.getByText(/different profile/i)).toBeInTheDocument();
        expect(mockOnUnlocked).not.toHaveBeenCalled();
      });

      // Should NOT clear the biometric data (it belongs to another profile)
      expect(mockBiometricVault.clear).not.toHaveBeenCalled();
    });
  });

  describe("per-profile isolation", () => {
    it("should use correct profileId for unlock", async () => {
      window.localStorage.setItem("profileId", "7");
      mockBiometricVault.hasSavedValue.mockResolvedValue(true);
      mockBiometricVault.unlock.mockResolvedValue({
        profileId: 7,
        key: "test",
      });
      mockUnlockProfileCacheWithKey.mockResolvedValue(undefined);

      render(
        <OfflineUnlock
          onUnlocked={mockOnUnlocked}
          onChangeServer={mockOnChangeServer}
          onListenWithoutProgress={mockOnListenWithoutProgress}
        />
      );

      const unlockButton = await screen.findByText(/unlock with fingerprint or face/i);
      await userEvent.click(unlockButton);

      await waitFor(() => {
        expect(mockBiometricVault.unlock).toHaveBeenCalledWith(7);
        expect(mockUnlockProfileCacheWithKey).toHaveBeenCalledWith(7, expect.any(Uint8Array));
      });
    });

    it("should clear correct profileId on key invalidation", async () => {
      window.localStorage.setItem("profileId", "7");
      mockBiometricVault.hasSavedValue.mockResolvedValue(true);
      mockBiometricVault.unlock.mockRejectedValue(
        new Error("VAULT_KEY_INVALID")
      );
      mockBiometricVault.clear.mockResolvedValue(undefined);

      render(
        <OfflineUnlock
          onUnlocked={mockOnUnlocked}
          onChangeServer={mockOnChangeServer}
          onListenWithoutProgress={mockOnListenWithoutProgress}
        />
      );

      const unlockButton = await screen.findByText(/unlock with fingerprint or face/i);
      await userEvent.click(unlockButton);

      await waitFor(() => {
        expect(mockBiometricVault.clear).toHaveBeenCalledWith(7);
      });
    });
  });
});
