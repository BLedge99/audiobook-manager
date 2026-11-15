import { type FormEvent, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { copy } from "../../copy";
import { Btn, Field } from "../../ui/primitives";

export interface HouseholdFormProps {
  busy: boolean;
  onSignIn(password: string): void | Promise<void>;
  onBack(): void;
}

/**
 * The household password (spec 3): setup and recovery, not the daily sign-in.
 */
export function HouseholdForm({ busy, onSignIn, onBack }: HouseholdFormProps) {
  const [password, setPassword] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSignIn(password);
  };

  return (
    <form onSubmit={submit} className="mt-5 grid gap-3">
      <label htmlFor="household-password" className="sr-only">
        {copy.login.passwordLabel}
      </label>
      <Field
        id="household-password"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        placeholder={copy.login.passwordPlaceholder}
        autoComplete="current-password"
        autoFocus
      />
      <Btn type="submit" variant="primary" disabled={busy} className="w-full">
        {busy ? copy.login.checking : copy.login.submit}
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
