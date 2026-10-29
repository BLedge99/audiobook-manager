import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OfflineUnlock } from "./OfflineUnlock";
import { copy } from "../copy";
import { localDb } from "../local/db";
import {
  exportActiveProfileKey,
  lockOfflineCache,
  rememberProfileKey,
  toBase64,
} from "../local/privateCache";

const vaultMocks = vi.hoisted(() => ({
  hasSavedValue: vi.fn(),
  unlock: vi.fn(),
  clear: vi.fn(),
}));

vi.mock("../lib/biometricVault", () => ({
  biometricVault: {
    hasSavedValue: vaultMocks.hasSavedValue,
    unlock: vaultMocks.unlock,
    clear: vaultMocks.clear,
  },
}));

/**
 * Spec 29. The point of these tests is the *exits*: this screen used to have
 * none, and a saved fingerprint key that Android had invalidated (enrolling a
 * new fingerprint does that) left both the fingerprint and the password
 * unusable, so the only way out was force-quitting the app.
 */
function renderScreen(overrides: Partial<Parameters<typeof OfflineUnlock>[0]> = {}) {
  const onUnlocked = vi.fn();
  const onChangeServer = vi.fn();
  const onListenWithoutProgress = vi.fn();
  render(
    <OfflineUnlock
      onUnlocked={onUnlocked}
      onChangeServer={onChangeServer}
      onListenWithoutProgress={onListenWithoutProgress}
      {...overrides}
    />,
  );
  return { onUnlocked, onChangeServer, onListenWithoutProgress };
}

describe("OfflineUnlock", () => {
  beforeEach(async () => {
    window.localStorage.clear();
    lockOfflineCache();
    await localDb.keyEnvelopes.clear();
    await localDb.privateRows.clear();
    vaultMocks.hasSavedValue.mockReset().mockResolvedValue(false);
    vaultMocks.unlock.mockReset();
    vaultMocks.clear.mockReset();
  });

  it("opens the cache with the profile password", async () => {
    window.localStorage.setItem("profileId", "7");
    await rememberProfileKey(7, "correct-horse-9");
    lockOfflineCache();
    const { onUnlocked } = renderScreen();

    fireEvent.change(screen.getByPlaceholderText(copy.account.passwordPlaceholder), {
      target: { value: "correct-horse-9" },
    });
    fireEvent.click(screen.getByRole("button", { name: copy.login.submit }));

    await waitFor(() => expect(onUnlocked).toHaveBeenCalled());
  });

  it("shows the same wrong-password sentence and does not delete the cache", async () => {
    window.localStorage.setItem("profileId", "7");
    await rememberProfileKey(7, "correct-horse-9");
    lockOfflineCache();
    const { onUnlocked } = renderScreen();

    fireEvent.change(screen.getByPlaceholderText(copy.account.passwordPlaceholder), {
      target: { value: "wrong-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: copy.login.submit }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(copy.login.wrongPassword),
    );
    expect(onUnlocked).not.toHaveBeenCalled();
    expect(await localDb.keyEnvelopes.get(7)).toBeDefined();
  });

  it("explains a device with downloads but no envelope", async () => {
    window.localStorage.setItem("profileId", "7");
    renderScreen();

    fireEvent.change(screen.getByPlaceholderText(copy.account.passwordPlaceholder), {
      target: { value: "anything" },
    });
    fireEvent.click(screen.getByRole("button", { name: copy.login.submit }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(copy.offline.unlockIntroNoKey),
    );
  });

  it("always offers a way to the server address", () => {
    const { onChangeServer } = renderScreen();
    fireEvent.click(screen.getByRole("button", { name: copy.operator.serverSetup.changeAddress }));
    expect(onChangeServer).toHaveBeenCalled();
  });

  it("always offers to listen without progress", () => {
    const { onListenWithoutProgress } = renderScreen();
    fireEvent.click(screen.getByRole("button", { name: copy.offline.listenWithoutProgress }));
    expect(onListenWithoutProgress).toHaveBeenCalled();
  });

  it("keeps both exits visible when the password unlocks nothing", async () => {
    // The dead-end state: downloads, a profile hint, but no envelope. Neither
    // the password nor (possibly) the fingerprint can succeed, so the exits
    // must still be on screen after the failure rather than replaced by it.
    window.localStorage.setItem("profileId", "7");
    renderScreen();

    fireEvent.change(screen.getByPlaceholderText(copy.account.passwordPlaceholder), {
      target: { value: "anything" },
    });
    fireEvent.click(screen.getByRole("button", { name: copy.login.submit }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    expect(
      screen.getByRole("button", { name: copy.operator.serverSetup.changeAddress }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: copy.offline.listenWithoutProgress }),
    ).toBeInTheDocument();
  });

  it("retries a transient fingerprint failure exactly once", async () => {
    window.localStorage.setItem("profileId", "7");
    await rememberProfileKey(7, "correct-horse-9");
    const key = await exportActiveProfileKey(7);
    lockOfflineCache();
    vaultMocks.hasSavedValue.mockResolvedValue(true);
    vaultMocks.unlock
      .mockRejectedValueOnce(new Error("Biometric prompt error code 3: sensor timed out"))
      .mockResolvedValueOnce({ profileId: 7, key: toBase64(key!) });

    const { onUnlocked } = renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: copy.security.deviceSignIn }));

    await waitFor(() => expect(onUnlocked).toHaveBeenCalled());
    expect(vaultMocks.unlock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a cancellation", async () => {
    window.localStorage.setItem("profileId", "7");
    vaultMocks.hasSavedValue.mockResolvedValue(true);
    vaultMocks.unlock.mockRejectedValue(new Error("Biometric prompt error code 10: User canceled"));

    const { onUnlocked } = renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: copy.security.deviceSignIn }));

    await waitFor(() => expect(vaultMocks.unlock).toHaveBeenCalledOnce());
    // Cancelling is a decision, so nothing is shouted back and the prompt is
    // not thrown up again (spec 29).
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(onUnlocked).not.toHaveBeenCalled();
  });

  it("keeps both exits usable while a prompt is still open", async () => {
    vaultMocks.hasSavedValue.mockResolvedValue(true);
    vaultMocks.unlock.mockReturnValue(new Promise(() => undefined));

    const { onListenWithoutProgress } = renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: copy.security.deviceSignIn }));
    await waitFor(() => expect(vaultMocks.unlock).toHaveBeenCalled());

    // A sensor that never answers must not hold the screen shut: the exits are
    // not gated on the prompt finishing.
    const exit = screen.getByRole("button", { name: copy.offline.listenWithoutProgress });
    expect(exit).toBeEnabled();
    fireEvent.click(exit);
    expect(onListenWithoutProgress).toHaveBeenCalled();
  });
});
