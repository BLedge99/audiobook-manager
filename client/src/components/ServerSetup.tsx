import { useState, type FormEvent } from "react";
import { Plug } from "lucide-react";
import { setServerUrl } from "../lib/api";
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
export function ServerSetup({ onDone }: { onDone: () => void }) {
  const [value, setValue] = useState("");
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
      setMessage(error instanceof Error ? error.message : "Enter a server address.");
      return;
    }

    setStatus("checking");
    setMessage("");
    try {
      const response = await fetch(`${saved}/api/health`);
      if (!response.ok) throw new Error(`the server replied ${response.status}`);
      onDone();
    } catch (error) {
      setStatus("failed");
      setMessage(
        `Could not reach ${saved}. Check the address, and that the phone is on the home WiFi. (${
          error instanceof Error ? error.message : "network error"
        })`,
      );
    }
  };

  return (
    <FullScreen>
      <div className="flex flex-col items-center">
        <Wordmark title="Audiobook Manager" subtitle="local-first listening" />

        <form onSubmit={submit} className="panel mt-8 w-full max-w-md px-6 py-7">
          <span className="grid size-14 -rotate-6 place-items-center rounded-[18px_14px_18px_14px/14px_18px_14px_18px] border-2 border-ink bg-cobalt">
            <Plug size={24} className="text-white" aria-hidden="true" />
          </span>

          <h1 className="mt-4 font-display text-2xl font-semibold text-ink">Connect to your library</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink2">
            Enter the address of the server at home, for example{" "}
            <code className="rounded bg-sunk px-1.5 py-0.5 font-bold text-cobalt-ink">
              http://192.168.1.203:3000
            </code>
            . You only do this once.
          </p>

          <Field
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="192.168.1.203:3000"
            autoCapitalize="off"
            autoCorrect="off"
            inputMode="url"
            aria-label="Server address"
            className="mt-5"
          />

          {message && (
            <p role="alert" className="mt-3 rounded-[14px_11px_14px_11px/11px_14px_11px_14px] border-2 border-ink bg-rasp/12 px-3 py-2 text-sm font-bold text-rasp-ink">
              {message}
            </p>
          )}

          <Btn type="submit" variant="primary" disabled={status === "checking"} className="mt-4 w-full">
            {status === "checking" ? "Checking…" : "Connect"}
          </Btn>
        </form>
      </div>
    </FullScreen>
  );
}