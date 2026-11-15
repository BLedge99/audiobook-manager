import { type FormEvent, useState } from "react";
import { Fingerprint, KeyRound, LoaderCircle, ArrowLeft } from "lucide-react";
import { copy } from "../../copy";
import { Btn, Field } from "../../ui/primitives";
import { isNativeShell } from "../../lib/platform";
import type { Account } from "./types";

export interface PasswordFormProps {
  account: Account;
  busy: boolean;
  passkeysAvailable: boolean;
  biometricsAvailable: boolean;
  onSignIn(password: string): void | Promise<void>;
  onPasskey(): void | Promise<void>;
  onBiometric(): void | Promise<void>;
  onBack(): void;
}

/**
 * One account, one password (spec 28). Passkeys and the native device unlock
 * are offered alongside, never instead — the password is always there.
 */
export function PasswordForm({
  account,
  busy,
  passkeysAvailable,
  biometricsAvailable,
  onSignIn,
  onPasskey,
  onBiometric,
  onBack,
}: PasswordFormProps) {
  const [password, setPassword] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSignIn(password);
  };

  return (
    <form onSubmit={submit} className="mt-5 grid gap-3">
      <label htmlFor="profile-password" className="sr-only">
        {copy.account.passwordLabel(account.name)}
      </label>
      <Field
        id="profile-password"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        placeholder={copy.account.passwordPlaceholder}
        autoComplete="current-password"
        autoFocus
      />
      <Btn type="submit" variant="primary" disabled={busy} className="w-full">
        {busy ? (
          <>
            <LoaderCircle size={17} className="animate-spin" aria-hidden="true" />
            {copy.login.checking}
          </>
        ) : (
          <>
            <KeyRound size={17} aria-hidden="true" />
            {copy.login.submit}
          </>
        )}
      </Btn>
      {passkeysAvailable && account.hasPasskey && !isNativeShell() && (
        <Btn
          type="button"
          variant="quiet"
          disabled={busy}
          onClick={() => void onPasskey()}
          className="w-full"
        >
          <Fingerprint size={17} aria-hidden="true" />
          {busy ? copy.security.adding : copy.security.signIn}
        </Btn>
      )}
      {biometricsAvailable && account.hasDeviceUnlock && isNativeShell() && (
        <Btn type="button" variant="quiet" disabled={busy} onClick={() => void onBiometric()} className="w-full">
          <Fingerprint size={17} aria-hidden="true" /> {copy.security.deviceSignIn}
        </Btn>
      )}
      {/* Spec 29: a control that silently disappears teaches nobody why
          it is gone. This profile has device sign-in set up, so the one
          thing the listener can do about it is enrol a fingerprint. */}
      {!biometricsAvailable && account.hasDeviceUnlock && isNativeShell() && (
        <p className="text-center text-[0.78125rem] leading-relaxed text-ink3">
          {copy.security.deviceUnavailable}
        </p>
      )}
      {biometricsAvailable && !account.hasDeviceUnlock && isNativeShell() && (
        <p className="text-center text-[0.78125rem] leading-relaxed text-ink3">
          {copy.security.deviceNeedsPassword}
        </p>
      )}
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center justify-center gap-1.5 text-sm font-bold text-ink3"
      >
        <ArrowLeft size={15} aria-hidden="true" />
        {copy.account.back}
      </button>
    </form>
  );
}
