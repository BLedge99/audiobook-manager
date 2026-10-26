import { type FormEvent, useState } from "react";
import { copy } from "../copy";
import { apiFetch, getActiveProfileId } from "../lib/api";
import { deleteProfileCache, rewrapProfileKey } from "../local/privateCache";
import { Btn, Field, Notice } from "../ui/primitives";

/**
 * Change this profile's password (spec 28, phase 8).
 *
 * The server change and the local re-wrap are one action from the listener's
 * point of view, so they happen together:
 *
 *  - the server verifies the current password, stores the new hash and revokes
 *    every other session;
 *  - the local encrypted cache re-wraps its DEK under the new password. The
 *    private rows are not re-encrypted, and the old password stops opening them.
 *
 * If this device has no envelope there is nothing to re-wrap. If the envelope
 * cannot be unwrapped with the password the server just accepted, the local
 * copy is out of step and is deleted rather than left locked under a password
 * that no longer works; the books and progress come back from the server.
 */
export function PasswordSettings({ offline = false }: { offline?: boolean }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [tone, setTone] = useState<"info" | "error">("info");
  const [message, setMessage] = useState("");

  const profileId = Number(getActiveProfileId());
  const hasProfile = Number.isInteger(profileId) && profileId >= 1;

  if (offline || !hasProfile) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage("");
    setTone("info");

    if (newPassword !== confirmPassword) {
      setTone("error");
      setMessage(copy.account.mismatch);
      return;
    }

    setBusy(true);
    try {
      await apiFetch("/api/auth/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      let cacheReset = false;
      try {
        await rewrapProfileKey(profileId, currentPassword, newPassword);
      } catch {
        await deleteProfileCache(profileId);
        cacheReset = true;
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage(
        cacheReset
          ? `${copy.security.passwordChanged} ${copy.security.passwordCacheReset}`
          : copy.security.passwordChanged,
      );
    } catch (error) {
      setTone("error");
      setMessage(
        error instanceof Error && error.message ? error.message : copy.security.passwordUnavailable,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-6 border-t-2 border-dashed border-ink/20 pt-5" aria-labelledby="password-heading">
      <h2 id="password-heading" className="font-display text-xl font-semibold text-ink">
        {copy.security.passwordHeading}
      </h2>
      <p className="mt-1 text-sm text-ink2">{copy.security.passwordIntro}</p>

      <form onSubmit={submit} className="mt-4 grid gap-3">
        <label htmlFor="current-password" className="text-[13px] font-bold text-ink">
          {copy.security.currentPasswordLabel}
        </label>
        <Field
          id="current-password"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          required
        />

        <label htmlFor="new-password" className="text-[13px] font-bold text-ink">
          {copy.account.newPasswordLabel}
        </label>
        <Field
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          required
        />

        <label htmlFor="confirm-password" className="text-[13px] font-bold text-ink">
          {copy.account.confirmPasswordLabel}
        </label>
        <Field
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          required
        />

        <div>
          <Btn type="submit" variant="primary" disabled={busy}>
            {busy ? copy.login.checking : copy.security.passwordChange}
          </Btn>
        </div>
      </form>

      {message && (
        <Notice tone={tone} role={tone === "error" ? "alert" : "status"} className="mt-3">
          {message}
        </Notice>
      )}
    </section>
  );
}
