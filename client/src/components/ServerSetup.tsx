import { useState, type FormEvent } from "react";
import { Plug } from "lucide-react";
import { getServerUrl, setServerUrl } from "../lib/api";
import { copy } from "../copy";
import { Btn, Field, FullScreen, Wordmark } from "../ui/primitives";

/**
 * First-run setup: ask for the home server's address.
 *
 * ## Why this exists
 *
 * `needsServerUrl()` was written and unit-tested but **never called from
 * anywhere**, which is the same "acceptance criterion with no call site" trap
 * that has bitten this project three times. The consequence on Android was a
 * dead end: `ProfileGate` covered the app, the only route to Settings was the
 * app header underneath it, and every API call resolved to the bundled
 * `index.html`, so a first-time user was shown "Cannot reach the server.
 * Unexpected token '<'" with no way to enter an address.
 *
 * ## Design
 *
 * A dedicated screen rather than the Settings modal, because this is a one-time
 * gate and the user needs to know the app cannot do anything yet. It reuses
 * `setServerUrl`, which already normalises a missing `http://` and a trailing
 * slash and throws a readable message on nonsense.
 *
 * `onDone` reloads rather than threading state through the app: the auth probe
 * has to re-run from scratch anyway, and this is the same trick
 * `ProfileSwitcher` uses.
 */
export function ServerSetup({
  onDone,
  onContinueOffline,
}: {
  onDone: () => void;
  /**
   * Offer offline mode when the home server cannot be reached, so the user can
   * browse and play the books they already have downloaded.
   */
  onContinueOffline?: () => void;
}) {
  const [value, setValue] = useState(() => getServerUrl());
  const [status, setStatus] = useState<"idle" | "checking" | "failed">("idle");
  const [message, setMessage] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    let saved: string;
    try {
      setServerUrl(value);
      saved = window.localStorage.getItem("serverUrl") || "";
    } catch (error) {
      setStatus("failed");
      setMessage(error instanceof Error ? error.message : copy.operator.serverSetup.enterAddress);
      return;
    }

    setStatus("checking");
    setMessage("");
    try {
      const response = await fetch(`${saved}/api/health`);
      if (!response.ok) throw new Error(copy.operator.serverReplied(response.status));
      onDone();
    } catch (error) {
      setStatus("failed");
      setMessage(
        copy.operator.serverSetup.unreachable(
          saved,
          error instanceof Error ? error.message : copy.operator.serverSetup.networkError,
        ),
      );
    }
  };

  return (
    <FullScreen>
      <div className="flex flex-col items-center">
        <Wordmark title={copy.brand.name} subtitle={copy.brand.tagline} />

        <form onSubmit={submit} className="panel mt-8 w-full max-w-md px-6 py-7">
          <span className="grid size-14 -rotate-6 place-items-center rounded-[18px_14px_18px_14px/14px_18px_14px_18px] border-2 border-ink bg-cobalt">
            <Plug size={24} className="text-white" aria-hidden="true" />
          </span>

          <h1 className="mt-4 font-display text-2xl font-semibold text-ink">{copy.operator.serverSetup.heading}</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink2">{copy.operator.serverSetup.intro}</p>
          <p className="mt-2 text-sm leading-relaxed text-ink2">
            {copy.operator.serverSetup.exampleLead}{" "}
            <code className="rounded bg-sunk px-1.5 py-0.5 font-bold text-cobalt-ink">
              {copy.operator.serverExample}
            </code>
          </p>

          <Field
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={copy.operator.serverSetup.addressPlaceholder}
            autoCapitalize="off"
            autoCorrect="off"
            inputMode="url"
            aria-label={copy.operator.serverAddressLabel}
            className="mt-5"
          />

          {message && (
            <p role="alert" className="mt-3 rounded-[14px_11px_14px_11px/11px_14px_11px_14px] border-2 border-ink bg-rasp/12 px-3 py-2 text-sm font-bold text-rasp-ink">
              {message}
            </p>
          )}

          <Btn type="submit" variant="primary" disabled={status === "checking"} className="mt-4 w-full">
            {status === "checking" ? copy.operator.serverSetup.checking : copy.operator.serverSetup.submit}
          </Btn>

          {onContinueOffline && (
            <Btn
              type="button"
              variant="quiet"
              onClick={onContinueOffline}
              className="mt-2 w-full"
            >
              {copy.operator.serverSetup.continueOffline}
            </Btn>
          )}
        </form>
      </div>
    </FullScreen>
  );
}