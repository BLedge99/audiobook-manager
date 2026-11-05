import { type FormEvent, useState } from "react";
import { LoaderCircle, UserRound } from "lucide-react";
import { copy } from "../copy";
import { boundedFetch, setActiveProfileId, setSessionToken } from "../lib/api";
import { responseErrorText } from "../lib/apiError";
import { rememberProfileKey } from "../local/privateCache";
import { Btn, Field } from "../ui/primitives";

export function ProfileRegistration({
  onRegistered,
  onCancel,
}: {
  onRegistered: (profileId: number, token: string | undefined, password: string) => void | Promise<void>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState("");
  const [householdPassword, setHouseholdPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password !== confirmPassword) {
      setError(copy.account.mismatch);
      return;
    }

    setBusy(true);
    setError(undefined);
    try {
      const response = await boundedFetch("/api/auth/register-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), householdPassword, password }),
      });
      if (!response.ok) {
        setError(await responseErrorText(response));
        return;
      }

      const result = await response.json() as { token?: string; profile?: { id?: number } };
      if (!Number.isInteger(result.profile?.id) || !result.profile?.id) {
        throw new Error(copy.errors.requestFailed(response.status));
      }
      const profileId = result.profile.id;
      setActiveProfileId(profileId);
      setSessionToken(result.token);
      try {
        await rememberProfileKey(profileId, password);
      } catch {
        // The account is created even when this device cannot encrypt offline progress.
      }
      await onRegistered(profileId, result.token, password);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : copy.login.unreachable);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-5 grid gap-3">
      <Field
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder={copy.profile.namePlaceholder}
        aria-label={copy.profile.nameLabel}
        autoComplete="name"
        required
      />
      <Field
        type="password"
        value={householdPassword}
        onChange={(event) => setHouseholdPassword(event.target.value)}
        placeholder={copy.account.householdPasswordLabel}
        aria-label={copy.account.householdPasswordLabel}
        autoComplete="current-password"
        required
      />
      <Field
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        placeholder={copy.account.newPasswordLabel}
        aria-label={copy.account.newPasswordLabel}
        autoComplete="new-password"
        required
      />
      <Field
        type="password"
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
        placeholder={copy.account.confirmPasswordLabel}
        aria-label={copy.account.confirmPasswordLabel}
        autoComplete="new-password"
        required
      />
      {error && (
        <p role="alert" className="rounded-[14px_11px_14px_11px/11px_14px_11px_14px] border-2 border-ink bg-rasp/12 px-3 py-2 text-sm font-bold text-rasp-ink">
          {error}
        </p>
      )}
      <Btn type="submit" variant="primary" disabled={busy} className="w-full">
        {busy ? (
          <>
            <LoaderCircle size={17} className="animate-spin" aria-hidden="true" />
            {copy.login.checking}
          </>
        ) : (
          <>
            <UserRound size={17} aria-hidden="true" />
            {copy.account.createProfileSubmit}
          </>
        )}
      </Btn>
      {onCancel && (
        <Btn type="button" variant="quiet" onClick={onCancel} disabled={busy} className="w-full">
          {copy.account.back}
        </Btn>
      )}
    </form>
  );
}
