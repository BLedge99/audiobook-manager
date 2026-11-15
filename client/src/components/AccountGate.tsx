import { LoaderCircle } from "lucide-react";
import { copy } from "../copy";
import { canOpenPrivacyNotice, onPrivacyNoticeClick, privacyNoticeUrl } from "../lib/privacyNotice";
import { ProfileRegistration } from "./ProfileRegistration";
import { GoogleOauthConfirm } from "./accountGate/GoogleOauthConfirm";
import { GateList } from "./accountGate/GateList";
import { PasswordForm } from "./accountGate/PasswordForm";
import { SetupForm } from "./accountGate/SetupForm";
import { HouseholdForm } from "./accountGate/HouseholdForm";
import { EmailForm } from "./accountGate/EmailForm";
import { useAccountGate } from "./accountGate/useAccountGate";
import { Btn, FullScreen, Wordmark } from "../ui/primitives";

/**
 * The account picker (spec 28).
 *
 * This replaces the shared-password gate as the normal way in. It is the only
 * screen that talks to the public `/api/auth/accounts` list, and it deliberately
 * does not reveal a hash, a passkey id or a role beyond what the picker needs.
 *
 * The household password is still reachable, but it is a separate mode with its
 * own explanation: it is for setup and recovery, not the daily sign-in.
 *
 * Everything interactive lives in `useAccountGate`; this file only renders it.
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
  const gate = useAccountGate({ onSuccess, accountExperience });
  const {
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
    heading,
    intro,
  } = gate;

  if (confirmOauth === "google") {
    return (
      <GoogleOauthConfirm
        onContinue={() => gate.startOAuth("google")}
        onBack={() => gate.setConfirmOauth(null)}
      />
    );
  }

  return (
    <FullScreen>
      <div className="flex flex-col items-center">
        <Wordmark title={copy.brand.name} subtitle={copy.brand.tagline} />

        <div className="panel mt-8 w-full min-w-0 max-w-sm px-4 py-6 sm:px-6 sm:py-7">
          <h1 className="font-display text-2xl font-semibold text-ink">{heading}</h1>
          <p className="mt-1.5 text-sm text-ink2">{intro}</p>

          {loading && (
            <p className="mt-5 flex items-center gap-2 text-sm font-bold text-ink2" role="status">
              <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
              {copy.login.checking}
            </p>
          )}

          {finishing && (
            <p className="mt-5 flex items-center gap-2 text-sm font-bold text-ink2" role="status">
              <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
              {copy.login.signingIn}
            </p>
          )}

          {!loading && !finishing && mode.kind === "list" && (
            <GateList
              accountExperience={accountExperience}
              accounts={accounts}
              accountsLoadFailed={accountsLoadFailed}
              error={error}
              oauthProviders={oauthProviders}
              onSelectAccount={gate.selectAccount}
              onRegister={gate.register}
              onHousehold={gate.householdMode}
              onStartOAuth={gate.startOAuth}
              onConfirmGoogle={() => gate.setConfirmOauth("google")}
              onEmail={gate.emailMode}
            />
          )}

          {!loading && mode.kind === "password" && (
            <PasswordForm
              account={mode.account}
              busy={busy}
              passkeysAvailable={passkeysAvailable}
              biometricsAvailable={biometricsAvailable}
              onSignIn={gate.signIn}
              onPasskey={gate.passkeySignIn}
              onBiometric={gate.biometricSignIn}
              onBack={gate.back}
            />
          )}

          {!loading && mode.kind === "setup" && (
            <SetupForm
              busy={busy}
              onSetup={gate.claim}
              onBack={gate.back}
            />
          )}

          {!loading && mode.kind === "household" && (
            <HouseholdForm
              busy={busy}
              onSignIn={gate.household}
              onBack={gate.back}
            />
          )}

          {!loading && mode.kind === "register" && (
            <ProfileRegistration
              onRegistered={(profileId, token) => gate.finish(profileId, token)}
              onCancel={gate.back}
            />
          )}

          {!loading && mode.kind === "email" && (
            <EmailForm
              signup={mode.signup}
              accountExperience={accountExperience}
              busy={busy}
              onSignIn={gate.emailSignIn}
              onToggleSignup={gate.emailMode}
              onBack={gate.back}
            />
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
          {canOpenPrivacyNotice() && (
            <a
              href={privacyNoticeUrl()}
              onClick={onPrivacyNoticeClick}
              className="mt-4 block text-center text-xs font-medium text-ink3 underline decoration-1 underline-offset-2 hover:text-ink"
            >
              {copy.privacy.link} &nbsp;·&nbsp; {copy.privacy.linkHint}
            </a>
          )}
        </div>
      </div>
    </FullScreen>
  );
}
