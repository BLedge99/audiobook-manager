import { UserRound } from "lucide-react";
import { copy } from "../../copy";
import type { Account } from "./types";
import { Btn, cn } from "../../ui/primitives";

const CAPSULE_TINTS = ["var(--rasp)", "var(--tan)", "var(--cobalt)", "var(--mint)"];

export interface GateListProps {
  accountExperience: "household" | "demo";
  accounts: Account[];
  accountsLoadFailed: boolean;
  /** Shown only when the accounts list itself failed to load (household). */
  error?: string;
  oauthProviders: string[];
  onSelectAccount(account: Account): void;
  onRegister(): void;
  onHousehold(): void;
  onStartOAuth(provider: "google" | "github"): void;
  onConfirmGoogle(): void;
  /** `signup` true opens the email form in create-account mode. */
  onEmail(signup: boolean): void;
}

/**
 * The front door (spec 28), list mode: the production-demo sign-in and the
 * household account picker. Whoever is holding the phone picks their name;
 * demo sessions go through OAuth/email instead.
 */
export function GateList({
  accountExperience,
  accounts,
  accountsLoadFailed,
  error,
  oauthProviders,
  onSelectAccount,
  onRegister,
  onHousehold,
  onStartOAuth,
  onConfirmGoogle,
  onEmail,
}: GateListProps) {
  if (accountExperience === "demo") {
    return (
      <div className="mt-5 grid min-w-0 gap-3">
        <button type="button" onClick={onConfirmGoogle} className="btn btn--glass w-full text-left">
          {copy.login.oauthGoogleAction}
        </button>
        <button type="button" onClick={() => onStartOAuth("github")} className="btn btn--glass w-full text-left">
          {copy.login.oauthGithubAction}
        </button>
        <button type="button" onClick={() => onEmail(false)} className="btn btn--glass w-full text-left">
          {copy.login.emailAction}
        </button>
        <button type="button" onClick={() => onEmail(true)} className="btn btn--glass w-full text-left">
          {copy.login.emailCreateAction}
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="mt-5 grid min-w-0 gap-3">
        {accounts.map((account, index) => (
          <button
            key={account.id}
            type="button"
            disabled={account.disabled}
            onClick={() => onSelectAccount(account)}
            className={cn(
              "capsule capsule--select flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left",
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
            <span className="min-w-0 flex-1 truncate font-display text-[1.0625rem] font-semibold text-ink">
              {account.name}
            </span>
            {account.disabled ? (
              <span className="shrink-0 text-[0.6875rem] font-bold text-ink3">
                {copy.account.disabled}
              </span>
            ) : !account.hasPassword ? (
              <span className="shrink-0 rounded-full border-2 border-ink bg-tan/40 px-2 py-0.5 text-[0.6875rem] font-bold text-ink">
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
        <Btn type="button" variant="quiet" onClick={onRegister} className="mt-4 w-full">
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
            onClick={onConfirmGoogle}
            className="btn btn--glass w-full text-left"
          >
            {copy.login.oauthGoogleAction}
          </button>
        )}
        {oauthProviders.includes("github") && (
          <button
            type="button"
            onClick={() => onStartOAuth("github")}
            className="btn btn--glass w-full text-left"
          >
            {copy.login.oauthGithubAction}
          </button>
        )}
        <button
          type="button"
          onClick={() => onEmail(false)}
          className="btn btn--glass w-full text-left"
        >
          {copy.login.emailAction}
        </button>
      </div>

      <button
        type="button"
        onClick={onHousehold}
        className="mt-5 text-sm font-bold text-cobalt-ink underline decoration-2 underline-offset-2"
      >
        {copy.account.useHousehold}
      </button>
    </>
  );
}
