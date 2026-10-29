import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeviceUnlockSettings } from "./DeviceUnlockSettings";

// Mock dependencies
const mockBiometricVault = {
  supported: () => true,
  available: vi.fn(),
  hasSavedValue: vi.fn(),
  save: vi.fn(),
  clear: vi.fn(),
};

const mockBoundedFetch = vi.fn();
const mockGetActiveProfileId = vi.fn();
const mockExportActiveProfileKey = vi.fn();
const mockActiveCacheKey = vi.fn();
const mockToBase64 = vi.fn();

vi.mock("../lib/biometricVault", () => ({
  biometricVault: mockBiometricVault,
}));

vi.mock("../lib/api", () => ({
  boundedFetch: (...args: unknown[]) => mockBoundedFetch(...args),
  getActiveProfileId: () => mockGetActiveProfileId(),
}));

vi.mock("../local/privateCache", () => ({
  exportActiveProfileKey: (...args: unknown[]) => mockExportActiveProfileKey(...args),
  activeCacheKey: (...args: unknown[]) => mockActiveCacheKey(...args),
  toBase64: (...args: unknown[]) => mockToBase64(...args),
}));

describe("DeviceUnlockSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetActiveProfileId.mockReturnValue("4");
    mockBiometricVault.available.mockResolvedValue(true);
    mockBiometricVault.hasSavedValue.mockResolvedValue(false);
    mockBoundedFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ devices: [] }),
    });
  });

  describe("offline mode", () => {
    it("should show biometric setup UI when offline", async () => {
      render(<DeviceUnlockSettings offline={true} />);
      
      await waitFor(() => {
        expect(screen.getByText("Fingerprint or face")).toBeInTheDocument();
      });
      
      expect(screen.getByText(/use this device's screen lock to open your profile offline/i)).toBeInTheDocument();
    });

    it("should enable biometrics without server registration when offline", async () => {
      mockActiveCacheKey.mockReturnValue(true);
      mockExportActiveProfileKey.mockResolvedValue(new Uint8Array([1, 2, 3]));
      mockToBase64.mockReturnValue("AQID");
      mockBiometricVault.save.mockResolvedValue(undefined);
      
      render(<DeviceUnlockSettings offline={true} />);
      
      await waitFor(() => {
        expect(screen.getByText("Enable offline fingerprint or face")).toBeInTheDocument();
      });
      
      const enableButton = screen.getByText("Enable offline fingerprint or face");
      await userEvent.click(enableButton);
      
      await waitFor(() => {
        expect(mockBiometricVault.save).toHaveBeenCalledWith(
          4,
          expect.objectContaining({
            profileId: 4,
            key: "AQID",
          })
        );
      });
      
      // Should NOT call server API
      expect(mockBoundedFetch).not.toHaveBeenCalledWith(
        "/api/auth/devices",
        expect.objectContaining({ method: "POST" })
      );
    });

    it("should handle save retry on transient error", async () => {
      mockActiveCacheKey.mockReturnValue(true);
      mockExportActiveProfileKey.mockResolvedValue(new Uint8Array([1, 2, 3]));
      mockToBase64.mockReturnValue("AQID");
      
      // First attempt fails with transient error, second succeeds
      mockBiometricVault.save
        .mockRejectedValueOnce(new Error("VAULT_UNAVAILABLE: transient"))
        .mockResolvedValueOnce(undefined);
      
      render(<DeviceUnlockSettings offline={true} />);
      
      await waitFor(() => {
        expect(screen.getByText("Enable offline fingerprint or face")).toBeInTheDocument();
      });
      
      const enableButton = screen.getByText("Enable offline fingerprint or face");
      await userEvent.click(enableButton);
      
      await waitFor(() => {
        expect(mockBiometricVault.save).toHaveBeenCalledTimes(2);
        expect(screen.getByText(/fingerprint or face unlock is ready/i)).toBeInTheDocument();
      });
    });

    it("should show error when cache key not available", async () => {
      mockActiveCacheKey.mockReturnValue(false);
      mockExportActiveProfileKey.mockResolvedValue(null);
      
      render(<DeviceUnlockSettings offline={true} />);
      
      await waitFor(() => {
        const enableButton = screen.getByText("Enable offline fingerprint or face");
        expect(enableButton).toBeDisabled();
      });
    });
  });

  describe("online mode", () => {
    it("should register device with server when online", async () => {
      mockActiveCacheKey.mockReturnValue(true);
      mockExportActiveProfileKey.mockResolvedValue(new Uint8Array([1, 2, 3]));
      mockToBase64.mockReturnValue("AQID");
      mockBoundedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ devices: [] }),
      }).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "device-123", secret: "secret-456" }),
      });
      mockBiometricVault.save.mockResolvedValue(undefined);
      
      render(<DeviceUnlockSettings offline={false} />);
      
      await waitFor(() => {
        expect(screen.getByText("Enable fingerprint or face")).toBeInTheDocument();
      });
      
      const enableButton = screen.getByText("Enable fingerprint or face");
      await userEvent.click(enableButton);
      
      await waitFor(() => {
        expect(mockBoundedFetch).toHaveBeenCalledWith(
          "/api/auth/devices",
          expect.objectContaining({
            method: "POST",
            body: expect.stringContaining("This device"),
          })
        );
        
        expect(mockBiometricVault.save).toHaveBeenCalledWith(
          4,
          expect.objectContaining({
            profileId: 4,
            secret: "secret-456",
            key: "AQID",
          })
        );
      });
    });

    it("should delete server device record if biometric save fails", async () => {
      mockActiveCacheKey.mockReturnValue(true);
      mockExportActiveProfileKey.mockResolvedValue(new Uint8Array([1, 2, 3]));
      mockToBase64.mockReturnValue("AQID");
      
      // Server registration succeeds
      mockBoundedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ devices: [] }),
      }).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "device-123", secret: "secret-456" }),
      }).mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });
      
      // Biometric save fails
      mockBiometricVault.save.mockRejectedValue(new Error("VAULT_UNAVAILABLE"));
      
      render(<DeviceUnlockSettings offline={false} />);
      
      await waitFor(() => {
        expect(screen.getByText("Enable fingerprint or face")).toBeInTheDocument();
      });
      
      const enableButton = screen.getByText("Enable fingerprint or face");
      await userEvent.click(enableButton);
      
      await waitFor(() => {
        // Should clean up the server device record
        expect(mockBoundedFetch).toHaveBeenCalledWith(
          "/api/auth/devices/device-123",
          expect.objectContaining({ method: "DELETE" })
        );
        
        expect(screen.getByText(/didn't work/i)).toBeInTheDocument();
      });
    });
  });

  describe("remove device", () => {
    it("should clear biometric data with correct profileId", async () => {
      mockBiometricVault.hasSavedValue.mockResolvedValue(true);
      mockBoundedFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ 
          devices: [{ id: "device-123", label: "This device" }] 
        }),
      }).mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });
      mockBiometricVault.clear.mockResolvedValue(undefined);
      
      render(<DeviceUnlockSettings offline={false} />);
      
      await waitFor(() => {
        expect(screen.getByText("Remove")).toBeInTheDocument();
      });
      
      const removeButton = screen.getByText("Remove");
      await userEvent.click(removeButton);
      
      await waitFor(() => {
        expect(mockBiometricVault.clear).toHaveBeenCalledWith(4);
      });
    });
  });

  describe("per-profile data isolation", () => {
    it("should use profile-specific storage", async () => {
      mockGetActiveProfileId.mockReturnValue("5");
      mockActiveCacheKey.mockReturnValue(true);
      mockExportActiveProfileKey.mockResolvedValue(new Uint8Array([5, 6, 7]));
      mockToBase64.mockReturnValue("BQYH");
      mockBiometricVault.save.mockResolvedValue(undefined);
      
      render(<DeviceUnlockSettings offline={true} />);
      
      await waitFor(() => {
        expect(mockBiometricVault.hasSavedValue).toHaveBeenCalledWith(5);
      });
      
      const enableButton = await screen.findByText("Enable offline fingerprint or face");
      await userEvent.click(enableButton);
      
      await waitFor(() => {
        expect(mockBiometricVault.save).toHaveBeenCalledWith(
          5,
          expect.objectContaining({
            profileId: 5,
            key: "BQYH",
          })
        );
      });
    });
  });

  describe("unavailable biometrics", () => {
    it("should show explanation when biometrics not available", async () => {
      mockBiometricVault.available.mockResolvedValue(false);
      
      render(<DeviceUnlockSettings offline={false} />);
      
      await waitFor(() => {
        expect(screen.getByText(/enrol a fingerprint in android settings/i)).toBeInTheDocument();
      });
      
      expect(screen.queryByText("Enable fingerprint or face")).not.toBeInTheDocument();
    });
  });
});
