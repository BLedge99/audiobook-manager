import { type FormEvent, useEffect, useState } from "react";
import { ArrowLeft, Fingerprint, KeyRound, LoaderCircle, UserRound } from "lucide-react";
import { copy } from "../copy";
import {
  boundedFetch,
  clearPendingProfileId,
  fetchAppConfig,
  getPendingProfileId,
  setActiveProfileId,
  setSessionToken,
} from "../lib/api";
import { errorSentenceForCode, responseErrorText } from "../lib/apiError";
import { isNativeShell } from "../lib/platform";
import { PasskeyError, passkeysSupported, signInWithPasskey } from "../lib/passkeys";
import { deviceName, getInstallationId } from "../lib/deviceIdentity";
import { deleteProfileCache, fromBase64, lockOfflineCache, rememberProfileKey, unlockProfileCacheWithKey } from "../local/privateCache";
import { biometricVault } from "../lib/biometricVault";
import { toBase64, exportActiveProfileKey } from "../local/privateCache";
import { ProfileRegistration } from "./ProfileRegistration";
import {
  biometricFailureMessage,
  classifyBiometricFailure,
  shouldClearSavedKey,
  shouldRetryBiometricUnlock,
} from "../lib/biometricFailure";
import { Btn, Field, FullScreen, Wordmark, cn } from "../ui/primitives";

interface Account {
  id: number;
  name: string;
  color?: string | null;
  role: "admin" | "member";
  disabled: boolean;
  hasPassword: boolean;
  hasPasskey: boolean;
  hasDeviceUnlock: boolean;
}

type Mode =
  | { kind: "list" }
  | { kind: "password"; account: Account }
  | { kind: "setup"; account: Account }
  | { kind: "household" }
  | { kind: "register" }
  | { kind: "email" };

const CAPSULE_TINTS = ["var(--rasp)", "var(--tan)", "var(--cobalt)", "var(--mint)"];

function errorSentence(error: unknown): string {
  return error instanceof Error ? error.message : copy.login.unreachable;
}

/**
 * The account picker (spec 28).
 *
 * This replaces the shared-password gate as the normal way in. It is the only
 * screen that talks to the public `/api/auth/accounts` list, and it deliberately
 * does not reveal a hash, a passkey id or a role beyond what the picker needs.
 *
 * The household password is still reachable, but it is a separate mode with its
 * own explanation: it is for setup and recovery, not the daily sign-in.
 */
export function AccountGate({
  onSuccess,
  accountExperience = "household",
  onContinueOffline,
}: {
  onSuccess: (result?: { offline: boolean }) => void | Promise<void>;
  accountExperience?: "household" | "demo";
  /** Offered in the native shell so the listener is never soft-locked offline. */
  onContinueOffline?: () => void;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [loading, setLoading] = useState(true);
  const [accountsLoadFailed, setAccountsLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [emailSignup, setEmailSignup] = useState(false);
  const [householdPassword, setHouseholdPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passkeysAvailable, setPasskeysAvailable] = useState(() => passkeysSupported());
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);
  const [oauthProviders, setOAuthProviders] = useState<string[]>([]);

  useEffect(() => { void biometricVault.available().then(setBiometricsAvailable); }, []);

  // Spec 32 / ADR 023: the OAuth callback redirects home with `?auth_error=<code>`
  // when the flow fails, so the listener sees it without a session.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("auth_error");
    if (code) setError(errorSentenceForCode(code));
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        if (accountExperience === "demo") {
          if (alive) {
            setAccounts([]);
            const config = await fetchAppConfig();
            setOAuthProviders(config.oauthProviders ?? []);
            const authError = new URLSearchParams(window.location.search).get("auth_error");
            const signup = new URLSearchParams(window.location.search).get("account_action") === "signup";
            if (signup) setEmailSignup(true);
            setMode(authError || signup ? { kind: "email" } : { kind: "list" });
          }
          return;
        }
        const res = await boundedFetch("/api/auth/accounts");
        if (!res.ok) {
          if (alive) {
            setAccountsLoadFailed(true);
            setError(copy.account.loadFailed(res.status));
          }
          return;
        }
        const list = (await res.json()) as Account[];
        if (!alive) return;
        setAccounts(list);
        setAccountsLoadFailed(false);
        const pending = getPendingProfileId();
        if (pending) {
          const match = list.find((account) => String(account.id) === pending);
          if (match) {
            setMode(match.hasPassword
              ? { kind: "password", account: match }
              : { kind: "setup", account: match });
          }
        }
      } catch (loadError) {
        if (alive) {
          setAccountsLoadFailed(true);
          setError(errorSentence(loadError));
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [accountExperience]);

  const finish = async (profileId: number | null, token: string | undefined, offline = false) => {
    setSessionToken(token);
    setActiveProfileId(accountExperience === "demo" ? null : profileId);
    if (profileId === null || accountExperience === "demo") lockOfflineCache();
    clearPendingProfileId();
    await onSuccess({ offline });
  };

  /**
   * Unwrap or create the offline key while the password is still in hand. A
   * failure here must not fail the sign-in: the server session is valid, and
   * the cache is a convenience until the next successful unlock.
   */
  const rememberKey = async (profileId: number, password: string) => {
    try {
      await rememberProfileKey(profileId, password);
    } catch {
      // Encryption unavailable (old WebView, private mode). Online still works.
    }
  };

  /**
   * Set the phone up for fingerprint sign-in, if it is not set up already.
   *
   * Spec 36: this used to be skipped whenever the **server** held a
   * credential for the profile. That is the wrong test. The Keystore key is
   * invalidated when a new fingerprint is enrolled, and the saved value is
   * then cleared while the server's credential survives -- so biometrics could
   * never be set up again, and every attempt in Settings added another
   * credential to the list.
   *
   * The test is now the Vault: does this phone hold a value that can sign in
   * on its own?
   */
  const enrollDeviceUnlock = async (profileId: number) => {
    if (!biometricsAvailable || mode.kind !== "password") return;
    if (biometricVault.hasSecret(profileId)) return;
    let deviceId: string | undefined;
    try {
      const key = await exportActiveProfileKey(profileId);
      if (!key) return;
      const response = await boundedFetch("/api/auth/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The phone names itself (spec 36): "Pixel 4a" rather than "Android
        // device", so the signed-in devices panel can tell two phones apart.
        // The device id also makes this a rotation of the phone's existing
        // credential rather than a second one.
        body: JSON.stringify({
          label: deviceName(copy.security.thisDevice),
          deviceId: getInstallationId(),
        }),
      });
      if (!response.ok) return;
      const created = (await response.json()) as { id: string; secret: string };
      deviceId = created.id;
      await biometricVault.save(profileId, {
        profileId,
        secret: created.secret,
        key: toBase64(key),
      });
    } catch {
      if (deviceId) {
        await boundedFetch(`/api/auth/devices/${encodeURIComponent(deviceId)}`, { method: "DELETE" }).catch(() => undefined);
      }
    }
  };

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    if (mode.kind !== "password") return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await boundedFetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: mode.account.id, password }),
      });
      if (!res.ok) {
        setError(await responseErrorText(res));
        return;
      }
      const body = (await res.json()) as {
        token?: string;
        authDisabled?: boolean;
        profile?: { id: number };
      };
      if (body.authDisabled || body.token === "disabled") {
        // Development with no APP_PASSWORD: the header path still chooses the
        // profile, and there is no password to collect.
        await finish(mode.account.id, undefined);
        return;
      }
      await rememberKey(mode.account.id, password);
      if (isNativeShell()) await enrollDeviceUnlock(mode.account.id);
      await finish(body.profile?.id ?? mode.account.id, body.token);
    } catch (submitError) {
      setError(errorSentence(submitError));
    } finally {
      setBusy(false);
    }
  };

  const passkeySignIn = async () => {
    if (mode.kind !== "password") return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await signInWithPasskey(mode.account.id);
      // No password is in hand, so the previous profile's key must not stay
      // unlocked. Offline data asks for the password separately.
      lockOfflineCache();
      await finish(
        result.profile?.id ?? mode.account.id,
        result.authDisabled ? undefined : result.token,
      );
    } catch (error) {
      if (error instanceof PasskeyError && error.code === "passkey_not_configured") {
        setPasskeysAvailable(false);
        setError(copy.login.passkeyUnavailable);
      } else {
        setError(copy.security.failed);
      }
    } finally {
      setBusy(false);
    }
  };

  const biometricSignIn = async () => {
    if (mode.kind !== "password") return;
    const accountId = mode.account.id;
    setBusy(true); setError(undefined);
    try {
      /*
       * The first biometric prompt after launch can fail transiently on some
       * devices (keystore / sensor warm-up), so a transient failure is retried
       * once. Everything else is classified rather than guessed at
       * (`lib/biometricFailure.ts`): the old table retried cancellation, which
       * re-opened the prompt after someone had already chosen the password.
       */
      let saved: { profileId: number; secret?: string; key: string };
      try {
        for (let attempt = 0; ; attempt += 1) {
          try {
            saved = await biometricVault.unlock<{
              profileId: number;
              secret?: string;
              key: string;
            }>(accountId);
            break;
          } catch (promptError) {
            if (attempt === 0 && shouldRetryBiometricUnlock(promptError)) continue;
            throw promptError;
          }
        }
      } catch (promptError) {
        const failure = classifyBiometricFailure(promptError);
        if (shouldClearSavedKey(failure)) {
          /*
           * The Keystore key can never open this value again (enrolling a new
           * fingerprint invalidates it). Drop it so device sign-in can be set
           * up again, and say so once -- this is self-healing, not an error the
           * listener has to work around.
           */
          await biometricVault.clear(accountId).catch(() => undefined);
        }
        const sentence = biometricFailureMessage(failure, {
          failed: copy.login.deviceFailed,
          locked: copy.login.deviceLocked,
          needsSetup: copy.login.deviceNeedsSetup,
          unavailable: copy.login.deviceUnavailable,
          transient: copy.login.deviceTransient,
        });
        // A cancellation is a choice, not a failure: stay silent and leave the
        // password form exactly where it is.
        if (sentence) setError(sentence);
        return;
      }

      if (saved.profileId !== accountId) {
        // The value is valid, just for another profile on this phone. Clearing
        // it would destroy that profile's device sign-in.
        setError(copy.login.deviceOtherProfile);
        return;
      }
      if (!saved.secret) {
        /*
         * The Vault holds a value but no device secret.
         *
         * That happens when the phone was set up while the server was
         * unreachable, or when the secret was lost with an invalidated
         * Keystore key and the phone was set up again offline. Either way the
         * fingerprint can open the profile *locally*, but the phone cannot
         * sign in to the server on its own, and it cannot ask for a new
         * secret either: enrolling a device needs a session, and the session
         * is what the secret would buy.
         *
         * So the password is needed once. The password sign-in re-enrols the
         * phone, which puts the secret back in the Vault.
         */
        setError(copy.login.deviceNeedsPasswordOnline);
        return;
      }

      let token: string | undefined;
      let offlineSignIn = false;
      try {
        const response = await boundedFetch("/api/auth/devices/session", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ secret: saved.secret }),
        });
        if (!response.ok) {
          if (response.status === 401 || response.status === 404) {
            await biometricVault.clear(accountId);
            await deleteProfileCache(saved.profileId);
            setError(copy.login.deviceGone);
            return;
          }
          setError(copy.login.deviceFailed);
          return;
        }
        token = ((await response.json()) as { token?: string }).token;
      } catch {
        // The DEK can open this profile offline; no server session is invented.
        offlineSignIn = true;
      }
      // Unlock with the saved key (works for both offline-only and online-registered modes)
      await unlockProfileCacheWithKey(saved.profileId, fromBase64(saved.key));
      await finish(saved.profileId, token, offlineSignIn);
    } catch {
      setError(copy.login.deviceFailed);
    } finally { setBusy(false); }
  };

  const claim = async (event: FormEvent) => {
    event.preventDefault();
    if (mode.kind !== "setup") return;
    if (newPassword !== confirmPassword) {
      setError(copy.account.mismatch);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const res = await boundedFetch("/api/auth/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: mode.account.id,
          householdPassword,
          newPassword,
        }),
      });
      if (!res.ok) {
        setError(await responseErrorText(res));
        return;
      }
      const body = (await res.json()) as { token?: string; profile?: { id: number } };
      await rememberKey(mode.account.id, newPassword);
      await finish(body.profile?.id ?? mode.account.id, body.token);
    } catch (submitError) {
      setError(errorSentence(submitError));
    } finally {
      setBusy(false);
    }
  };

  const emailSignIn = async (event: FormEvent) => {
    event.preventDefault();
    if (mode.kind !== "email") return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await boundedFetch(emailSignup ? "/api/auth/signup" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        setError(await responseErrorText(res));
        return;
      }
      const body = (await res.json()) as { token?: string; authDisabled?: boolean; profile?: { id?: number } };
      if (body.authDisabled || body.token === "disabled") {
        await finish(null, undefined);
        return;
      }
      await finish(null, body.token);
    } catch (submitError) {
      setError(errorSentence(submitError));
    } finally {
      setBusy(false);
    }
  };

  /** Spec 32 / ADR 023: hand off to the provider authorize endpoint. */
  const startOAuth = (provider: "google" | "github") => {
    window.location.href = `/api/auth/${provider}/authorize`;
  };

  const household = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const res = await boundedFetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: householdPassword }),
      });
      if (!res.ok) {
        setError(await responseErrorText(res));
        return;
      }
      const body = (await res.json()) as { token?: string; authDisabled?: boolean };
      await finish(null, body.authDisabled || body.token === "disabled" ? undefined : body.token);
    } catch (submitError) {
      setError(errorSentence(submitError));
    } finally {
      setBusy(false);
    }
  };

  const back = () => {
    clearPendingProfileId();
    setMode({ kind: "list" });
    setPassword("");
    setEmail("");
    setHouseholdPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setError(undefined);
  };

  const heading =
    mode.kind === "setup"
      ? copy.account.setupHeading(mode.account.name)
      : mode.kind === "household"
        ? copy.account.householdHeading
      : mode.kind === "register"
        ? copy.account.createProfile
      : mode.kind === "email"
          ? emailSignup ? copy.login.emailCreateHeading : copy.login.heading
          : copy.profile.heading;

  return (
    <FullScreen>
      <div className="flex flex-col items-center">
        <Wordmark title={copy.brand.name} subtitle={copy.brand.tagline} />

        <div className="panel mt-8 w-full min-w-0 max-w-sm px-4 py-6 sm:px-6 sm:py-7">
          <h1 className="font-display text-2xl font-semibold text-ink">{heading}</h1>
          <p className="mt-1.5 text-sm text-ink2">
            {mode.kind === "setup"
              ? copy.account.setupIntro
              : mode.kind === "household"
                ? copy.account.householdIntro
                : mode.kind === "register"
                  ? copy.account.registerIntro
                : mode.kind === "password"
                  ? copy.account.passwordLabel(mode.account.name)
                  : mode.kind === "email"
                    ? emailSignup ? copy.login.emailCreateHeading : copy.login.emailIntro
                    : copy.account.intro}
          </p>

          {loading && (
            <p className="mt-5 flex items-center gap-2 text-sm font-bold text-ink2" role="status">
              <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
              {copy.login.checking}
            </p>
          )}

          {!loading && mode.kind === "list" && accountExperience === "demo" && (
            <>
              <div className="mt-5 grid min-w-0 gap-3">
                <a href="/api/auth/google/authorize" className="block w-full rounded-2xl border-2 border-ink bg-tan/40 px-4 py-3 text-left text-sm font-bold text-ink">
                  {copy.login.oauthGoogleAction}
                </a>
                <a href="/api/auth/github/authorize" className="block w-full rounded-2xl border-2 border-ink bg-tan/40 px-4 py-3 text-left text-sm font-bold text-ink">
                  {copy.login.oauthGithubAction}
                </a>
                <button type="button" onClick={() => { setError(undefined); setMode({ kind: "email" }); }} className="w-full rounded-2xl border-2 border-ink bg-tan/40 px-4 py-3 text-left text-sm font-bold text-ink">
                  {copy.login.emailAction}
                </button>
                <button type="button" onClick={() => { setEmailSignup(true); setError(undefined); setMode({ kind: "email" }); }} className="w-full rounded-2xl border-2 border-ink bg-tan/40 px-4 py-3 text-left text-sm font-bold text-ink">
                  {copy.login.emailCreateAction}
                </button>
              </div>
            </>
          )}

          {!loading && mode.kind === "list" && accountExperience === "household" && (
            <>
              <div className="mt-5 grid min-w-0 gap-3">
                {accounts.map((account, index) => (
                  <button
                    key={account.id}
                    type="button"
                    disabled={account.disabled}
                    onClick={() =>
                      setMode(
                        account.hasPassword
                          ? { kind: "password", account }
                          : { kind: "setup", account },
                      )
                    }
                    className={cn(
                      "capsule flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left",
                      index % 2 ? "capsule--alt" : "",
                      account.disabled && "opacity-55",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="grid size-10 shrink-0 place-items-center rounded-full border-2 border-ink"
                      style={{ background: account.color ?? CAPSULE_TINTS[index % CAPSULE_TINTS.length] }}
                    >
                      <UserRound size={18} className="text-white" />
                    </span>
                    <span className="min-w-0 flex-1 truncate font-display text-[17px] font-semibold text-ink">
                      {account.name}
                    </span>
                    {account.disabled ? (
                      <span className="shrink-0 text-[11px] font-bold text-ink3">
                        {copy.account.disabled}
                      </span>
                    ) : !account.hasPassword ? (
                      <span className="shrink-0 rounded-full border-2 border-ink bg-tan/40 px-2 py-0.5 text-[11px] font-bold text-ink">
                        {copy.account.needsSetup}
                      </span>
                    ) : null}
                  </button>
                ))}
                {!accounts.length && !accountsLoadFailed && (
                  <p className="panel panel--sunk px-4 py-5 text-center text-sm text-ink2">
                    {copy.account.noProfiles}
                  </p>
                )}
              </div>

              {!accountsLoadFailed && (
                <Btn
                  type="button"
                  variant="quiet"
                  onClick={() => {
                    setError(undefined);
                    setMode({ kind: "register" });
                  }}
                  className="mt-4 w-full"
                >
                  {copy.account.createProfile}
                </Btn>
              )}
              {accountsLoadFailed && error && (
                <p role="alert" className="text-sm font-bold text-rasp-ink">{error}</p>
              )}

              <div className="mt-5 grid min-w-0 gap-3">
                {oauthProviders.includes("google") && (
                  <button
                    type="button"
                    onClick={() => startOAuth("google")}
                    className="w-full rounded-2xl border-2 border-ink bg-tan/40 px-4 py-3 text-left text-sm font-bold text-ink"
                  >
                    {copy.login.oauthGoogleAction}
                  </button>
                )}
                {oauthProviders.includes("github") && (
                  <button
                    type="button"
                    onClick={() => startOAuth("github")}
                    className="w-full rounded-2xl border-2 border-ink bg-tan/40 px-4 py-3 text-left text-sm font-bold text-ink"
                  >
                    {copy.login.oauthGithubAction}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setError(undefined);
                    setMode({ kind: "email" });
                  }}
                  className="w-full rounded-2xl border-2 border-ink bg-tan/40 px-4 py-3 text-left text-sm font-bold text-ink"
                >
                  {copy.login.emailAction}
                </button>
              </div>

              <button
                type="button"
                onClick={() => {
                  setError(undefined);
                  setMode({ kind: "household" });
                }}
                className="mt-5 text-sm font-bold text-cobalt-ink underline decoration-2 underline-offset-2"
              >
                {copy.account.useHousehold}
              </button>
            </>
          )}

          {!loading && mode.kind === "password" && (
            <form onSubmit={signIn} className="mt-5 grid gap-3">
              <label htmlFor="profile-password" className="sr-only">
                {copy.account.passwordLabel(mode.account.name)}
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
              {passkeysAvailable && mode.account.hasPasskey && !isNativeShell() && (
                <Btn
                  type="button"
                  variant="quiet"
                  disabled={busy}
                  onClick={() => void passkeySignIn()}
                  className="w-full"
                >
                  <Fingerprint size={17} aria-hidden="true" />
                  {busy ? copy.security.adding : copy.security.signIn}
                </Btn>
              )}
              {biometricsAvailable && mode.account.hasDeviceUnlock && isNativeShell() && (
                <Btn type="button" variant="quiet" disabled={busy} onClick={() => void biometricSignIn()} className="w-full">
                  <Fingerprint size={17} aria-hidden="true" /> {copy.security.deviceSignIn}
                </Btn>
              )}
              {/* Spec 29: a control that silently disappears teaches nobody why
                  it is gone. This profile has device sign-in set up, so the one
                  thing the listener can do about it is enrol a fingerprint. */}
              {!biometricsAvailable && mode.account.hasDeviceUnlock && isNativeShell() && (
                <p className="text-center text-[12.5px] leading-relaxed text-ink3">
                  {copy.security.deviceUnavailable}
                </p>
              )}
              {biometricsAvailable && !mode.account.hasDeviceUnlock && isNativeShell() && (
                <p className="text-center text-[12.5px] leading-relaxed text-ink3">
                  {copy.security.deviceNeedsPassword}
                </p>
              )}
              <button
                type="button"
                onClick={back}
                className="inline-flex items-center justify-center gap-1.5 text-sm font-bold text-ink3"
              >
                <ArrowLeft size={15} aria-hidden="true" />
                {copy.account.back}
              </button>
            </form>
          )}

          {!loading && mode.kind === "setup" && (
            <form onSubmit={claim} className="mt-5 grid gap-3">
              <p className="rounded-[14px_11px_14px_11px/11px_14px_11px_14px] border-2 border-ink bg-tan/25 px-3 py-2 text-sm font-bold text-ink">
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
                autoComplete={emailSignup ? "new-password" : "current-password"}
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
                onClick={back}
                className="inline-flex items-center justify-center gap-1.5 text-sm font-bold text-ink3"
              >
                <ArrowLeft size={15} aria-hidden="true" />
                {copy.account.back}
              </button>
            </form>
          )}

          {!loading && mode.kind === "household" && (
            <form onSubmit={household} className="mt-5 grid gap-3">
              <label htmlFor="household-password" className="sr-only">
                {copy.login.passwordLabel}
              </label>
              <Field
                id="household-password"
                type="password"
                value={householdPassword}
                onChange={(event) => setHouseholdPassword(event.target.value)}
                placeholder={copy.login.passwordPlaceholder}
                autoComplete="current-password"
                autoFocus
              />
              <Btn type="submit" variant="primary" disabled={busy} className="w-full">
                {busy ? copy.login.checking : copy.login.submit}
              </Btn>
              <button
                type="button"
                onClick={back}
                className="inline-flex items-center justify-center gap-1.5 text-sm font-bold text-ink3"
              >
                <ArrowLeft size={15} aria-hidden="true" />
                {copy.account.back}
              </button>
            </form>
          )}

          {!loading && mode.kind === "register" && (
            <ProfileRegistration
              onRegistered={(profileId, token) => finish(profileId, token)}
              onCancel={back}
            />
          )}

          {!loading && mode.kind === "email" && (
            <form onSubmit={emailSignIn} className="mt-5 grid gap-3">
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
                    {emailSignup ? copy.login.emailCreateSubmit : copy.login.submit}
                  </>
                )}
              </Btn>
              {!emailSignup && accountExperience === "demo" && (
                <button type="button" onClick={() => setEmailSignup(true)} className="text-sm font-bold text-cobalt-ink underline">
                  {copy.login.emailCreateAction}
                </button>
              )}
              {emailSignup && accountExperience === "demo" && (
                <button type="button" onClick={() => setEmailSignup(false)} className="text-sm font-bold text-cobalt-ink underline">
                  {copy.login.emailAction}
                </button>
              )}
              <button
                type="button"
                onClick={back}
                className="inline-flex items-center justify-center gap-1.5 text-sm font-bold text-ink3"
              >
                <ArrowLeft size={15} aria-hidden="true" />
                {copy.account.back}
              </button>
            </form>
          )}

          {error && !(mode.kind === "list" && accountsLoadFailed && accountExperience === "household") && (
            <p
              role="alert"
              className="mt-3 rounded-[14px_11px_14px_11px/11px_14px_11px_14px] border-2 border-ink bg-rasp/12 px-3 py-2 text-sm font-bold text-rasp-ink"
            >
              {error}
            </p>
          )}

          {onContinueOffline && (
            <Btn
              type="button"
              variant="quiet"
              onClick={onContinueOffline}
              className="mt-4 w-full"
            >
              {copy.operator.serverSetup.continueOffline}
            </Btn>
          )}
          <a
            href="/privacy"
            className="mt-4 block text-center text-xs font-medium text-ink3 underline decoration-1 underline-offset-2 hover:text-ink"
          >
            {copy.privacy.link} &nbsp;·&nbsp; {copy.privacy.linkHint}
          </a>
        </div>
      </div>
    </FullScreen>
  );
}
