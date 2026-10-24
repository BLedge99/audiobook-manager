import { type FormEvent, useState } from "react";
import { CloudOff, KeyRound, LoaderCircle } from "lucide-react";
import { copy } from "../copy";
import {
  CacheKeyMissingError,
  unlockProfileCache,
  WrongPasswordError,
} from "../local/privateCache";
import { Btn, Field, FullScreen, Wordmark } from "../ui/primitives";

/**
 * Offline sign-in for the downloaded library (spec 28, phase 4).
 *
 * The server cannot check a password when it is unreachable, so the check is
 * local: the password derives the KEK and unwraps the DEK. A wrong password is
 * an AES-GCM authentication failure and changes nothing. This is deliberately
 * distinct from the online account picker -- there is no account list to fetch
 * and no session to create.
 */
export function OfflineUnlock({
  onUnlocked,
}: {
  onUnlocked: () => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const profileId = Number(window.localStorage.getItem("profileId"));
    if (!Number.isInteger(profileId) || profileId < 1) {
      setError(copy.offline.noCache);
      return;
    }

    setBusy(true);
    setError(undefined);
    try {
      await unlockProfileCache(profileId, password);
      onUnlocked();
    } catch (unlockError) {
      if (unlockError instanceof WrongPasswordError) {
        setError(copy.login.wrongPassword);
      } else if (unlockError instanceof CacheKeyMissingError) {
        setError(copy.offline.noCache);
      } else {
        setError(copy.offline.unlockFailed);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <FullScreen>
      <div className="flex flex-col items-center">
        <Wordmark title={copy.brand.name} subtitle={copy.brand.tagline} />

        <div className="panel mt-8 w-full max-w-sm px-6 py-7">
          <span className="mx-auto grid size-14 -rotate-6 place-items-center rounded-[18px_14px_18px_14px/14px_18px_14px_18px] border-2 border-ink bg-sunk">
            <CloudOff size={24} aria-hidden="true" className="text-ink3" />
          </span>
          <h1 className="mt-5 text-center font-display text-2xl font-semibold text-ink">
            {copy.offline.unlockHeading}
          </h1>
          <p className="mt-2 text-center text-sm text-ink2">{copy.offline.unlockIntro}</p>

          <form onSubmit={submit} className="mt-5 grid gap-3">
            <label htmlFor="offline-password" className="sr-only">
              {copy.account.passwordPlaceholder}
            </label>
            <Field
              id="offline-password"
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
          </form>

          {error && (
            <p
              role="alert"
              className="mt-3 rounded-[14px_11px_14px_11px/11px_14px_11px_14px] border-2 border-ink bg-rasp/12 px-3 py-2 text-sm font-bold text-rasp-ink"
            >
              {error}
            </p>
          )}
        </div>
      </div>
    </FullScreen>
  );
}
