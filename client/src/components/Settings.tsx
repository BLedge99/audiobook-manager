import { type FormEvent, useState } from "react";
import { HardDriveDownload, LoaderCircle, Save, Server, WifiOff } from "lucide-react";
import { getServerUrl, setServerUrl } from "../lib/api";
import { Btn, Field, MachineMark, Notice, Tube } from "../ui/primitives";

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
    <div className="fixed inset-0 z-50 overflow-y-auto bg-ground px-4 py-8 sm:px-5">
      <div className="mx-auto max-w-xl">
        <div className="mb-7 flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <MachineMark />
            <h2 className="min-w-0 font-display text-[26px] font-semibold leading-tight text-ink">
              Home server
            </h2>
          </div>
          <Btn variant="quiet" size="sm" onClick={onClose} className="shrink-0">
            Close
          </Btn>
        </div>

        <form onSubmit={test} className="panel grid gap-3 p-5">
          <label htmlFor="server-url" className="flex items-center gap-2 text-[14px] font-bold text-ink">
            <Server size={16} className="text-rasp" aria-hidden="true" />
            Server address
          </label>
          <Field
            id="server-url"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="http://192.168.1.203:3000"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
          <p className="text-[12.5px] text-ink3">
            On the home WiFi. If the router gives the server a new address, change it here — no
            reinstall needed.
          </p>
          <Btn type="submit" variant="primary" disabled={status === "checking"}>
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
          </Btn>

          {message && (
            <Notice tone={status === "ok" ? "info" : "error"} role="status">{message}</Notice>
          )}
        </form>

        <section className="panel mt-4 p-5">
          <h3 className="flex items-center gap-2 font-display text-[17px] font-semibold text-ink">
            <HardDriveDownload size={17} className="text-rasp" aria-hidden="true" />
            On this device
          </h3>
          {/* The tube, not a dial: there is no meaningful maximum to fill
              against, so a proportional ring would be a lie. */}
          <p className="mt-2 font-display text-[32px] font-semibold leading-none text-ink tnum">
            {formatBytes(usedBytes)}
          </p>
          <p className="mt-1 text-[13.5px] text-ink2">
            {downloadedCount} {downloadedCount === 1 ? "book" : "books"} downloaded
          </p>
          <Tube percent={downloadedCount > 0 ? 100 : 0} className="mt-3" />
          {offline && (
            <Notice tone="warn" role="status" icon={<WifiOff size={15} aria-hidden="true" />} className="mt-4">
              The server is unreachable. Downloaded books still play.
            </Notice>
          )}
        </section>
      </div>
    </div>
  );
}