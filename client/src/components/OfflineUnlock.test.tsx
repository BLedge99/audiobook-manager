import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OfflineUnlock } from "./OfflineUnlock";
import { copy } from "../copy";
import { localDb } from "../local/db";
import { lockOfflineCache, rememberProfileKey } from "../local/privateCache";

describe("OfflineUnlock", () => {
  beforeEach(async () => {
    window.localStorage.clear();
    lockOfflineCache();
    await localDb.keyEnvelopes.clear();
    await localDb.privateRows.clear();
  });

  it("opens the cache with the profile password", async () => {
    window.localStorage.setItem("profileId", "7");
    await rememberProfileKey(7, "correct-horse-9");
    lockOfflineCache();
    const onUnlocked = vi.fn();
    render(<OfflineUnlock onUnlocked={onUnlocked} />);

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
    const onUnlocked = vi.fn();
    render(<OfflineUnlock onUnlocked={onUnlocked} />);

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
    render(<OfflineUnlock onUnlocked={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText(copy.account.passwordPlaceholder), {
      target: { value: "anything" },
    });
    fireEvent.click(screen.getByRole("button", { name: copy.login.submit }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(copy.offline.noCache),
    );
  });
});
