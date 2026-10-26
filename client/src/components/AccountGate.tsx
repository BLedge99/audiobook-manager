import { type FormEvent, useEffect, useState } from "react";
import { ArrowLeft, Fingerprint, KeyRound, LoaderCircle, UserRound } from "lucide-react";
import { copy } from "../copy";
import {
  boundedFetch,
  setActiveProfileId,
  setSessionToken,
} from "../lib/api";
import { responseErrorText } from "../lib/apiError";
import { isNativeShell } from "../lib/platform";
import { PasskeyError, passkeysSupported, signInWithPasskey } from "../lib/passkeys";
import { deleteProfileCache, fromBase64, lockOfflineCache, rememberProfileKey, unlockProfileCacheWithKey } from "../local/privateCache";
import { biometricVault } from "../lib/biometricVault";
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
  | { kind: "household" };

const CAPSULE_TINTS = ["var(--rasp)", "var(--tan)", "var(--cobalt)", "var(--mint)"];
const PENDING_PROFILE_KEY = "pendingProfileId";

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
export function AccountGate({ onSuccess }: { onSuccess: () => void }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const [password, setPassword] = useState("");
  const [householdPassword, setHouseholdPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passkeysAvailable, setPasskeysAvailable] = useState(() => passkeysSupported());
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);

  useEffect(() => { void biometricVault.available().then(setBiometricsAvailable); }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await boundedFetch("/api/auth/accounts");
        if (!res.ok) {
          if (alive) setError(copy.account.loadFailed(res.status));
          return;
        }
        const list = (await res.json()) as Account[];
        if (!alive) return;
        setAccounts(list);
        const pending = window.localStorage.getItem(PENDING_PROFILE_KEY);
        if (pending) {
          const match = list.find((account) => String(account.id) === pending);
          if (match) {
            setMode(match.hasPassword
              ? { kind: "password", account: match }
              : { kind: "setup", account: match });
          }
        }
      } catch (loadError) {
        if (alive) setError(errorSentence(loadError));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const finish = (profileId: number | null, token: string | undefined) => {
    setSessionToken(token);
    setActiveProfileId(profileId);
    if (profileId === null) lockOfflineCache();
    window.localStorage.removeItem(PENDING_PROFILE_KEY);
    onSuccess();
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
        finish(mode.account.id, undefined);
        return;
      }
      await rememberKey(mode.account.id, password);
      finish(body.profile?.id ?? mode.account.id, body.token);
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
      finish(
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
    setBusy(true); setError(undefined);
    try {
      const saved = await biometricVault.unlock<{ profileId: number; secret: string; key: string }>();
      if (saved.profileId !== mode.account.id) throw new Error(copy.login.deviceFailed);
      let token: string | undefined;
      let response: Response | undefined;
      try {
        response = await boundedFetch("/api/auth/devices/session", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ secret: saved.secret }),
        });
      } catch {
        // The DEK can open this profile offline; no server session is invented.
      }
      if (response && !response.ok) {
        if (response.status === 401 || response.status === 404) {
          await biometricVault.clear();
          await deleteProfileCache(saved.profileId);
          throw new Error(copy.login.deviceGone);
        }
        throw new Error(copy.login.deviceFailed);
      }
      if (response) token = ((await response.json()) as { token?: string }).token;
      await unlockProfileCacheWithKey(saved.profileId, fromBase64(saved.key));
      finish(saved.profileId, token);
    } catch (error) {
      setError(error instanceof Error && error.message === copy.login.deviceGone
        ? copy.login.deviceGone
        : copy.login.deviceFailed);
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
      finish(body.profile?.id ?? mode.account.id, body.token);
    } catch (submitError) {
      setError(errorSentence(submitError));
    } finally {
      setBusy(false);
    }
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
      finish(null, body.authDisabled || body.token === "disabled" ? undefined : body.token);
    } catch (submitError) {
      setError(errorSentence(submitError));
    } finally {
      setBusy(false);
    }
  };

  const back = () => {
    window.localStorage.removeItem(PENDING_PROFILE_KEY);
    setMode({ kind: "list" });
    setPassword("");
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
                : mode.kind === "password"
                  ? copy.account.passwordLabel(mode.account.name)
                  : copy.account.intro}
          </p>

          {loading && (
            <p className="mt-5 flex items-center gap-2 text-sm font-bold text-ink2" role="status">
              <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
              {copy.login.checking}
            </p>
          )}

          {!loading && mode.kind === "list" && (
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
                {!accounts.length && (
                  <p className="panel panel--sunk px-4 py-5 text-center text-sm text-ink2">
                    {copy.account.noProfiles}
                  </p>
                )}
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
