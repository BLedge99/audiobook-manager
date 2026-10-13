import { type FormEvent, useState } from "react";
import { HardDriveDownload, LoaderCircle, Save, Server, WifiOff } from "lucide-react";
import { getServerUrl, setServerUrl } from "../lib/api";

export interface SettingsProps {
  /** Bytes held on the device, for the storage line. */
  usedBytes: number;
  /** Books currently on the device. */
  downloadedCount: number;
  /** True when the server could not be reached on the last attempt. */
  offline: boolean;
  onClose: () => void;
  /** Re-run the library load after a URL change. */
  onSaved: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(0)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/**
 * Server address and device storage (spec 26; Phase 4 work pulled into Sprint 2).
 *
 * The URL cannot be a build-time constant: the home router hands out a DHCP
 * address, and asking the household to reinstall the APK every time it changes
 * is not an acceptable answer. This was previously `server.url` in
 * `capacitor.config.ts`, which meant a rebuild.
 */
export function Settings({ usedBytes, downloadedCount, offline, onClose, onSaved }: SettingsProps) {
  const [value, setValue] = useState(getServerUrl());
  const [status, setStatus] = useState<"idle" | "checking" | "ok" | "failed">("idle");
  const [message, setMessage] = useState("");

  const test = async (event: FormEvent) => {
    event.preventDefault();
    let saved: string;
    try {
      setServerUrl(value);
      saved = getServerUrl();
    } catch (error) {
      setStatus("failed");
      setMessage(error instanceof Error ? error.message : "Enter a server address");
      return;
    }

    setStatus("checking");
    setMessage("");
    try {
      const response = await fetch(`${saved}/api/health`);
      if (!response.ok) throw new Error(`Server replied ${response.status}`);
      setStatus("ok");
      setMessage("Connected.");
      onSaved();
    } catch (error) {
      setStatus("failed");
      setMessage(
        `Could not reach ${saved}. Check the address and that the phone is on the home WiFi. (${
          error instanceof Error ? error.message : "network error"
        })`,
      );
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#0b1117]/98 px-5 py-10">
      <div className="mx-auto max-w-xl">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-400">Settings</p>
            <h2 className="mt-2 text-2xl font-bold">Home server</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
          >
            Close
          </button>
        </div>

        <form onSubmit={test} className="grid gap-3 border border-slate-800 bg-slate-900/60 p-5">
          <label htmlFor="server-url" className="flex items-center gap-2 text-sm font-medium text-slate-200">
            <Server size={16} className="text-cyan-400" aria-hidden="true" />
            Server address
          </label>
          <input
            id="server-url"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="http://192.168.1.203:3000"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            className="border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm outline-none focus:border-cyan-400"
          />
          <p className="text-xs text-slate-500">
            On the home WiFi. If the router gives the server a new address, change it here — no
            reinstall needed.
          </p>
          <button
            type="submit"
            disabled={status === "checking"}
            className="flex items-center justify-center gap-2 bg-cyan-400 px-4 py-2 font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-60"
          >
            {status === "checking" ? (
              <>
                <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
                Checking...
              </>
            ) : (
              <>
                <Save size={16} aria-hidden="true" />
                Save and test
              </>
            )}
          </button>

          {message && (
            <p
              className={`text-sm ${status === "ok" ? "text-emerald-300" : "text-red-300"}`}
              role="status"
            >
              {message}
            </p>
          )}
        </form>

        <section className="mt-6 border border-slate-800 bg-slate-900/60 p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
            <HardDriveDownload size={16} className="text-cyan-400" aria-hidden="true" />
            On this device
          </h3>
          <p className="mt-2 text-3xl font-bold">{formatBytes(usedBytes)}</p>
          <p className="text-sm text-slate-500">
            {downloadedCount} {downloadedCount === 1 ? "book" : "books"} downloaded
          </p>
          {offline && (
            <p className="mt-4 flex items-center gap-2 text-sm text-amber-300" role="status">
              <WifiOff size={15} aria-hidden="true" />
              The server is unreachable. Downloaded books still play.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}