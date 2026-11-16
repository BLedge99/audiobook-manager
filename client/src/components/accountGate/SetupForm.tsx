import { type FormEvent, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { copy } from "../../copy";
import { Btn, Field } from "../../ui/primitives";

export interface SetupFormProps {
  busy: boolean;
  onSetup(householdPassword: string, newPassword: string, confirmPassword: string): void | Promise<void>;
  onBack(): void;
}

/**
 * First-time claim for an unclaimed account (spec 28): the household password
 * proves this device may adopt the account, then a password is chosen.
 */
export function SetupForm({ busy, onSetup, onBack }: SetupFormProps) {
  const [householdPassword, setHouseholdPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSetup(householdPassword, newPassword, confirmPassword);
  };

  return (
    <form onSubmit={submit} className="mt-5 grid gap-3">
      <p className="rounded-[var(--r-pod-sm)] border-2 border-ink bg-tan/25 px-3 py-2 text-sm font-bold text-ink">
        {copy.account.unclaimedHint}
      </p>
      <label htmlFor="claim-household" className="sr-only">
        {copy.login.passwordLabel}
      </label>
      <Field
        id="claim-household"
        type="password"
        value={householdPassword}
        onChange={(event) => setHouseholdPassword(event.target.value)}
        placeholder={copy.login.passwordPlaceholder}
        autoComplete="current-password"
      />
      <label htmlFor="claim-new" className="sr-only">
        {copy.account.newPasswordLabel}
      </label>
      <Field
        id="claim-new"
        type="password"
        value={newPassword}
        onChange={(event) => setNewPassword(event.target.value)}
        placeholder={copy.account.newPasswordLabel}
        autoComplete="new-password"
      />
      <label htmlFor="claim-confirm" className="sr-only">
        {copy.account.confirmPasswordLabel}
      </label>
      <Field
        id="claim-confirm"
        type="password"
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
        placeholder={copy.account.confirmPasswordLabel}
        autoComplete="new-password"
      />
      <Btn type="submit" variant="primary" disabled={busy} className="w-full">
        {busy ? copy.login.checking : copy.account.setupSubmit}
      </Btn>
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
