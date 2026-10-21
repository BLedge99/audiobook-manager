import { type FormEvent, useState } from "react";
import { HardDriveDownload, LoaderCircle, Save, Server, WifiOff } from "lucide-react";
import { getServerUrl, setServerUrl } from "../lib/api";
import { copy } from "../copy";
import { Btn, Field, MachineMark, Notice, Tube } from "../ui/primitives";

export interface SettingsProps {
  /** Bytes held on the device, for the storage line. */
  usedBytes: number;
  /** Books currently on the device. */
  downloadedCount: number;
  /** True when the server could not be reached on the last attempt. */
  offline: boolean;
  /** Bytes of cover art cached. Omitted in shells with no cover cache. */
  coverBytes?: number;
  /** Forget every cached cover. Optional, so a caller may omit the control. */
  onClearCovers?: () => void;
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
export function Settings({
  usedBytes,
  downloadedCount,
  offline,
  coverBytes,
  onClearCovers,
  onClose,
  onSaved,
}: SettingsProps) {
  const [value, setValue] = useState(getServerUrl());
  const [status, setStatus] = useState<"idle" | "checking" | "ok" | "failed">("idle");
  const [message, setMessage] = useState("");
  const [coversCleared, setCoversCleared] = useState(false);

  const test = async (event: FormEvent) => {
    event.preventDefault();
    let saved: string;
    try {
      setServerUrl(value);
      saved = getServerUrl();
    } catch (error) {
      setStatus("failed");
      setMessage(error instanceof Error ? error.message : copy.operator.settings.enterAddress);
      return;
    }

    setStatus("checking");
    setMessage("");
    try {
      const response = await fetch(`${saved}/api/health`);
      if (!response.ok) throw new Error(`Server replied ${response.status}`);
      setStatus("ok");
      setMessage(copy.operator.settings.connected);
      onSaved();
    } catch (error) {
      setStatus("failed");
      setMessage(
        copy.operator.settings.unreachable(
          saved,
          error instanceof Error ? error.message : copy.operator.settings.networkError,
        ),
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
              {copy.operator.settings.heading}
            </h2>
          </div>
          <Btn variant="quiet" size="sm" onClick={onClose} className="shrink-0">
            {copy.operator.settings.close}
          </Btn>
        </div>

        <form onSubmit={test} className="panel grid gap-3 p-5">
          <label htmlFor="server-url" className="flex items-center gap-2 text-[14px] font-bold text-ink">
            <Server size={16} className="text-rasp" aria-hidden="true" />
            {copy.operator.serverAddressLabel}
          </label>
          <Field
            id="server-url"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={copy.operator.serverExample}
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
          <p className="text-[12.5px] text-ink3">{copy.operator.settings.addressHelp}</p>
          <Btn type="submit" variant="primary" disabled={status === "checking"}>
            {status === "checking" ? (
              <>
                <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
                {copy.operator.settings.checking}
              </>
            ) : (
              <>
                <Save size={16} aria-hidden="true" />
                {copy.operator.settings.saveAndTest}
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
            {copy.operator.settings.deviceHeading}
          </h3>
          {/* The tube, not a dial: there is no meaningful maximum to fill
              against, so a proportional ring would be a lie. */}
          <p className="mt-2 font-display text-[32px] font-semibold leading-none text-ink tnum">
            {formatBytes(usedBytes)}
          </p>
          <p className="mt-1 text-[13.5px] text-ink2">
            {copy.operator.settings.booksDownloaded(downloadedCount)}
          </p>
          <Tube percent={downloadedCount > 0 ? 100 : 0} className="mt-3" />
          {offline && (
            <Notice tone="warn" role="status" icon={<WifiOff size={15} aria-hidden="true" />} className="mt-4">
              {copy.operator.settings.serverUnreachable}
            </Notice>
          )}

          {/*
            Covers are cached separately from downloads, and for a different
            reason: a download is a deliberate copy the listener asked for,
            while covers exist so a shelf can be looked at offline. They are
            small (measured: 47 KB mean per cover) and refill themselves, so
            this is offered as a convenience rather than a rescue.

            The number is read on open rather than tracked live, so it cannot go
            stale while the panel is sitting there.
          */}
          {typeof coverBytes === "number" && (
            <div className="mt-4 border-t-2 border-dashed border-ink/20 pt-4">
              {/*
                The byte count used to be bolded inside the sentence. It is not
                now: the panel's headline figure is the one bold number, and
                `clarify` asks for whole sentences rather than a sentence split
                around a styled run. `tnum` on the line keeps the figures
                aligned.
              */}
              <p className="text-[13.5px] text-ink2 tnum">
                {copy.operator.settings.coversCached(formatBytes(coverBytes))}
              </p>
              {coversCleared ? (
                <p role="status" className="mt-2 text-[13px] font-bold text-cobalt-ink">
                  {copy.operator.settings.coversCleared}
                </p>
              ) : (
                <Btn
                  size="sm"
                  variant="quiet"
                  onClick={() => {
                    void onClearCovers?.();
                    setCoversCleared(true);
                  }}
                  className="mt-2"
                >
                  {copy.operator.settings.clearCovers}
                </Btn>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}