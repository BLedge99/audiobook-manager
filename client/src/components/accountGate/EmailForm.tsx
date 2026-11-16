import { type FormEvent, useState } from "react";
import { ArrowLeft, KeyRound, LoaderCircle } from "lucide-react";
import { copy } from "../../copy";
import { Btn, Field } from "../../ui/primitives";
import { isDemoExperience } from "../../local/experience";

export interface EmailFormProps {
  /** True = create-account form; false = sign-in form. */
  signup: boolean;
  accountExperience: "household" | "demo";
  busy: boolean;
  onSignIn(email: string, password: string, signup: boolean): void | Promise<void>;
  onToggleSignup(signup: boolean): void;
  onBack(): void;
}

/**
 * Email + password (spec 32, production demo): one form, two modes. The
 * create-account toggle only exists in demo mode.
 */
export function EmailForm({ signup, accountExperience, busy, onSignIn, onToggleSignup, onBack }: EmailFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSignIn(email, password, signup);
  };

  return (
    <form onSubmit={submit} className="mt-5 grid gap-3">
      <label htmlFor="email" className="sr-only">
        {copy.login.emailLabel}
      </label>
      <Field
        id="email"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder={copy.login.emailPlaceholder}
        autoComplete="email"
        autoFocus
      />
      <label htmlFor="email-password" className="sr-only">
        {copy.login.passwordLabel}
      </label>
      <Field
        id="email-password"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        placeholder={copy.login.passwordPlaceholder}
        autoComplete="current-password"
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
            {signup ? copy.login.emailCreateSubmit : copy.login.submit}
          </>
        )}
      </Btn>
      {!signup && isDemoExperience(accountExperience) && (
        <button type="button" onClick={() => onToggleSignup(true)} className="text-sm font-bold text-cobalt-ink underline">
          {copy.login.emailCreateAction}
        </button>
      )}
      {signup && isDemoExperience(accountExperience) && (
        <button type="button" onClick={() => onToggleSignup(false)} className="text-sm font-bold text-cobalt-ink underline">
          {copy.login.emailAction}
        </button>
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

