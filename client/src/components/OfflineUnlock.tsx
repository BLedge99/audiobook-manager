import { type FormEvent, useEffect, useState } from "react";
import { CloudOff, Fingerprint, KeyRound, LoaderCircle } from "lucide-react";
import { copy } from "../copy";
import {
  CacheKeyMissingError,
  unlockProfileCache,
  WrongPasswordError,
  unlockProfileCacheWithKey,
  fromBase64,
} from "../local/privateCache";
import { biometricVault } from "../lib/biometricVault";
import {
  biometricFailureMessage,
  classifyBiometricFailure,
  shouldRetryBiometricUnlock,
} from "../lib/biometricFailure";
import { Btn, Field, FullScreen, Wordmark } from "../ui/primitives";

/**
 * Offline sign-in for the downloaded library (spec 28, phase 4; spec 29).
 *
 * The server cannot check a password when it is unreachable, so the check is
 * local: the password derives the KEK and unwraps the DEK. A wrong password is
 * an AES-GCM authentication failure and changes nothing. This is deliberately
 * distinct from the online account picker -- there is no account list to fetch
 * and no session to create.
 *
 * ## Why this screen always has two exits
 *
 * It used to have none, which turned every unopenable cache into a permanent
 * dead end: no password can succeed without an envelope, and a saved
 * fingerprint value can become permanently undecryptable when Android
 * invalidates its Keystore key (enrolling a new fingerprint does exactly that).
 * A listener in that state could only force-quit the app.
 *
 * So the screen offers, below the form and in this order:
 *
 * - **Use a different server address** -- the usual fix when the app is offline
 *   because the phone is pointed at a stale address (an `adb reverse` tunnel,
 *   a changed LAN IP).
 * - **Listen without progress** -- the books are on the device and the shelf
 *   does not need the key. Only progress and favourites do. This is the
 *   listener's call, so it is a button, not an error state.
 */
export function OfflineUnlock({
  onUnlocked,
  onChangeServer,
  onListenWithoutProgress,
}: {
  onUnlocked: () => void;
  /** Leave for the server-address screen. */
  onChangeServer: () => void;
  /** Enter the shelf with progress and favourites hidden. */
  onListenWithoutProgress: () => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [hasBiometric, setHasBiometric] = useState(false);
  useEffect(() => { 
    const profileId = Number(window.localStorage.getItem("profileId"));
    if (Number.isInteger(profileId) && profileId > 0) {
      void biometricVault.hasSavedValue(profileId).then(setHasBiometric);
    }
  }, []);

  const unlockBiometric = async () => {
    setBusy(true); setError(undefined);
    try {
      const profileId = Number(window.localStorage.getItem("profileId"));
      /*
       * Same rule as the sign-in screen: a first prompt can fail transiently
       * while the sensor or Keystore warms up, and that is the only kind of
       * failure worth asking a second time. A cancellation is not retried --
       * re-opening the prompt is exactly how biometrics traps a person.
       */
      let saved: { profileId: number; key: string; secret?: string };
      for (let attempt = 0; ; attempt += 1) {
        try {
          saved = await biometricVault.unlock<{ profileId: number; key: string; secret?: string }>(profileId);
          break;
        } catch (promptError) {
          if (attempt === 0 && shouldRetryBiometricUnlock(promptError)) continue;
          throw promptError;
        }
      }
      if (saved.profileId !== profileId) {
        // The value is valid, just for someone else on this phone. Never clear
        // it: that would destroy the other profile's device sign-in.
        setError(copy.login.deviceOtherProfile);
        return;
      }
      // Unlock with the saved key (works for both offline-only and online-registered modes)
      await unlockProfileCacheWithKey(profileId, fromBase64(saved.key));
      onUnlocked();
    } catch (failure) {
      const kind = classifyBiometricFailure(failure);
      if (kind === "key-invalid") {
        // The Keystore key is gone for good. Drop the ciphertext so the device
        // can be set up again, and fall back to the password.
        const profileId = Number(window.localStorage.getItem("profileId"));
        await biometricVault.clear(profileId).catch(() => undefined);
        setHasBiometric(false);
      }
      setError(biometricFailureMessage(kind, {
        failed: copy.login.deviceFailed,
        locked: copy.login.deviceLocked,
        needsSetup: copy.login.deviceNeedsSetup,
        unavailable: copy.login.deviceUnavailable,
        transient: copy.login.deviceTransient,
      }));
    } finally { setBusy(false); }
  };

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
        // No envelope on this device. The fingerprint path may still work, so
        // this is not the end of the screen -- the exits below are.
        setError(copy.offline.unlockIntroNoKey);
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
          {hasBiometric && <Btn type="button" variant="quiet" disabled={busy} className="mt-3 w-full" onClick={() => void unlockBiometric()}>
            <Fingerprint size={17} aria-hidden="true" /> {copy.security.deviceSignIn}
          </Btn>}

          {error && (
            <p
              role="alert"
              className="mt-3 rounded-[14px_11px_14px_11px/11px_14px_11px_14px] border-2 border-ink bg-rasp/12 px-3 py-2 text-sm font-bold text-rasp-ink"
            >
              {error}
            </p>
          )}

          {/* The two exits. Quiet, but always present: an offline screen with no
              action is how listeners got stuck. Deliberately *not* disabled
              while a prompt is open -- a sensor that never answers must not be
              able to hold the screen shut. */}
          <div className="mt-4 grid gap-2 border-t-2 border-dashed border-ink/15 pt-4">
            <Btn type="button" variant="quiet" className="w-full" onClick={onChangeServer}>
              {copy.operator.serverSetup.changeAddress}
            </Btn>
            <Btn type="button" variant="quiet" className="w-full" onClick={onListenWithoutProgress}>
              {copy.offline.listenWithoutProgress}
            </Btn>
          </div>
        </div>
      </div>
    </FullScreen>
  );
}
