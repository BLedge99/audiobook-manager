import { useState, type FormEvent } from "react";
import { setServerUrl } from "../lib/api";

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
    <div className="grid min-h-screen place-items-center bg-[#0b1117] px-5 text-slate-100">
      <form onSubmit={submit} className="w-full max-w-md border border-slate-800 bg-slate-900 p-8">
        <h1 className="text-xl font-bold">Connect to your library</h1>
        <p className="mt-2 text-sm text-slate-400">
          Enter the address of the server at home, for example{" "}
          <code className="text-cyan-400">http://192.168.1.203:3000</code>. You only do this once.
        </p>
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="192.168.1.203:3000"
          autoCapitalize="off"
          autoCorrect="off"
          inputMode="url"
          className="mt-5 w-full border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-cyan-400"
        />
        {message && (
          <p role="alert" className="mt-3 text-sm text-red-400">
            {message}
          </p>
        )}
        <button
          disabled={status === "checking"}
          className="mt-5 w-full bg-cyan-400 py-2 font-semibold text-slate-950 hover:bg-cyan-300 disabled:opacity-60"
        >
          {status === "checking" ? "Checking…" : "Connect"}
        </button>
      </form>
    </div>
  );
}