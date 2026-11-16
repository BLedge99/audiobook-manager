import { useEffect, useRef, useState } from "react";
import { copy } from "../../copy";
import {
  clearPendingProfileId,
  fetchAppConfig,
  getPendingProfileId,
  setActiveProfileId,
  setSessionToken,
  apiUrl,
} from "../../lib/api";
import { requestRaw } from "../../lib/request";
import { beginNativeOAuth, subscribeNativeOAuth, type NativeOAuthResult } from "../../lib/oauthNative";
import { errorSentenceForCode, responseErrorText } from "../../lib/apiError";
import { isNativeShell } from "../../lib/platform";
import { PasskeyError, passkeysSupported, signInWithPasskey } from "../../lib/passkeys";
import { deviceName, getInstallationId } from "../../lib/deviceIdentity";
import { deleteProfileCache, fromBase64, lockOfflineCache, rememberProfileKey, unlockProfileCacheWithKey } from "../../local/privateCache";
import { biometricVault } from "../../lib/biometricVault";
import { toBase64, exportActiveProfileKey } from "../../local/privateCache";
import type { Account, Mode } from "./types";
import {
  biometricFailureMessage,
  classifyBiometricFailure,
  shouldClearSavedKey,
  shouldRetryBiometricUnlock,
} from "../../lib/biometricFailure";

function errorSentence(error: unknown): string {
  return error instanceof Error ? error.message : copy.login.unreachable;
}

/**
 * The account gate state machine (spec 41 phase 8): mode transitions, the
 * account list load, and every auth flow on the screen. The JSX that renders
 * the result lives in `AccountGate.tsx`; nothing here touches the DOM.
 */
export function useAccountGate({
  onSuccess,
  accountExperience = "household",
}: {
  onSuccess: (result?: { offline: boolean }) => void | Promise<void>;
  accountExperience?: "household" | "demo";
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [loading, setLoading] = useState(true);
  const [accountsLoadFailed, setAccountsLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  /** When the user chose "Sign in with Google", show a themed confirmation
   *  before handing off to Google. Google's own page cannot be themed, so a
   *  gentle on-ramp in our own visual language reduces the jarring color flip. */
  const [confirmOauth, setConfirmOauth] = useState<"google" | null>(null);

  const [passkeysAvailable, setPasskeysAvailable] = useState(() => passkeysSupported());
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);
  const [oauthProviders, setOAuthProviders] = useState<string[]>([]);
  // True from a native deep-link result until the app's probe lands and this
  // gate unmounts. The OAuth round trip completes server-side well before the
  // listener sees any change; without this, the screen looks dead and people
  // tap again (spec 32 / ADR 030).
  const [finishing, setFinishing] = useState(false);

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
            setMode(authError || signup ? { kind: "email", signup } : { kind: "list" });
          }
          return;
        }
        const res = await requestRaw("/api/auth/accounts");
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

  // Spec 32 / ADR 030: the native flow resolves out of process (Custom Tab →
  // deep link). The ref keeps the latest `finish` so the subscription doesn't
  // re-register or re-fire on every render; a cold-start result is parked in
  // the module and delivered here once the gate mounts.
  const finishRef = useRef(finish);
  finishRef.current = finish;
  useEffect(() => {
    if (!isNativeShell()) return;
    return subscribeNativeOAuth((result: NativeOAuthResult) => {
      if (result.kind === "ok") {
        // Keep the gate honest for the seconds the app takes to settle:
        // the token is already in hand and the probe is what flips this
        // screen away. If it never resolves, an 8-second timeout returns
        // the buttons with the reviewed failure sentence.
        setError(undefined);
        setFinishing(true);
        void finishRef.current(accountExperience === "demo" ? null : result.profileId, result.token);
        return;
      }
      setFinishing(false);
      setError(errorSentenceForCode(result.code));
    });
  }, [accountExperience]);

  useEffect(() => {
    if (!finishing) return undefined;
    const timer = window.setTimeout(() => {
      setFinishing(false);
      setError(copy.login.oauthFailed);
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [finishing]);

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
   * Attach this device's bookkeeping to the sign-in, whatever the enrolment state.
   *
   * Two operations, both cheap:
   *
   *  1. **Adopt the session** into the device credential in the server (no
   *     secret, no rotation). Without this, password sign-ins on a phone that
   *     is already enrolled each mint a fresh browser-style row in the
   *     "Signed-in devices" panel.
   *  2. **Enrol when the Vault has no secret** — first sign-in, or a Keystore
   *     that was invalidated and re-enrolled the wrong value. With a live
   *     secret there is nothing to set up; the exchange at launch does it.
   */
  const enrollDeviceUnlock = async (profileId: number) => {
    if (!biometricsAvailable || mode.kind !== "password") return;
    let deviceId: string | undefined;
    try {
      // Adopt this sign-in into the phone's existing device credential, so
      // the panel lists the phone once instead of one row per re-sign-in.
      // No secret, no rotation: this is the bookkeeping only.
      await requestRaw("/api/auth/devices/link", {
        method: "POST",
        body: { deviceId: getInstallationId() },
      }).catch(() => undefined);
      if (biometricVault.hasSecret(profileId)) return;
      const key = await exportActiveProfileKey(profileId);
      if (!key) return;
      const response = await requestRaw("/api/auth/devices", {
        method: "POST",
        body: {
          // The phone names itself (spec 36): "Pixel 4a" rather than "Android
          // device", so the signed-in devices panel can tell two phones apart.
          // The device id also makes this a rotation of the phone's existing
          // credential rather than a second one.
          label: deviceName(copy.security.thisDevice),
          deviceId: getInstallationId(),
        },
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
        await requestRaw(`/api/auth/devices/${encodeURIComponent(deviceId)}`, { method: "DELETE" }).catch(() => undefined);
      }
    }
  };

  const signIn = async (password: string) => {
    if (mode.kind !== "password") return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await requestRaw("/api/auth/login", {
        method: "POST",
        body: { profileId: mode.account.id, password },
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
        const response = await requestRaw("/api/auth/devices/session", {
          method: "POST",
          body: { secret: saved.secret },
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

  const claim = async (householdPassword: string, newPassword: string, confirmPassword: string) => {
    if (mode.kind !== "setup") return;
    if (newPassword !== confirmPassword) {
      setError(copy.account.mismatch);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const res = await requestRaw("/api/auth/claim", {
        method: "POST",
        body: {
          profileId: mode.account.id,
          householdPassword,
          newPassword,
        },
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

  const emailSignIn = async (email: string, password: string) => {
    if (mode.kind !== "email") return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await requestRaw(mode.signup ? "/api/auth/signup" : "/api/auth/login", {
        method: "POST",
        body: { email, password },
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

  /** Spec 32 / ADR 030: native shells hand the consent page to Chrome Custom
      Tabs and resume on a deep link; the browser navigates the WebView origin
      (`https://localhost`), which cannot serve /api/auth/... — hence the absolute
      `apiUrl`. The native branch never touches window.location. */
  const startOAuth = (provider: "google" | "github") => {
    if (isNativeShell()) {
      beginNativeOAuth(provider).catch(() => {
        setError(copy.login.oauthFailed);
      });
      return;
    }
    window.location.href = apiUrl(`/api/auth/${provider}/authorize`);
  };

  const householdSignIn = async (password: string) => {
    setBusy(true);
    setError(undefined);
    try {
      const res = await requestRaw("/api/auth/login", {
        method: "POST",
        body: { password },
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
          ? mode.signup ? copy.login.emailCreateHeading : copy.login.heading
          : copy.profile.heading;

  const intro =
    mode.kind === "setup"
      ? copy.account.setupIntro
      : mode.kind === "household"
        ? copy.account.householdIntro
        : mode.kind === "register"
          ? copy.account.registerIntro
          : mode.kind === "password"
            ? copy.account.passwordLabel(mode.account.name)
            : mode.kind === "email"
              ? mode.signup ? copy.login.emailCreateHeading : copy.login.emailIntro
              : copy.account.intro;

  return {
    accounts,
    mode,
    loading,
    accountsLoadFailed,
    finishing,
    busy,
    error,
    confirmOauth,
    oauthProviders,
    passkeysAvailable,
    biometricsAvailable,
    accountExperience,
    heading,
    intro,
    selectAccount: (account: Account) =>
      setMode(
        account.hasPassword
          ? { kind: "password", account }
          : { kind: "setup", account },
      ),
    register: () => {
      setError(undefined);
      setMode({ kind: "register" });
    },
    householdMode: () => {
      setError(undefined);
      setMode({ kind: "household" });
    },
    emailMode: (signup: boolean) => {
      setError(undefined);
      setMode({ kind: "email", signup });
    },
    setConfirmOauth,
    startOAuth,
    signIn,
    passkeySignIn,
    biometricSignIn,
    claim,
    emailSignIn,
    household: householdSignIn,
    back,
    finish,
  };
}
