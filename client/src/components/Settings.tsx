import { type FormEvent, useEffect, useState } from "react";
import { HardDriveDownload, LoaderCircle, Save, Server, WifiOff, X } from "lucide-react";
import { getServerUrl, setServerUrl } from "../lib/api";
import {
  ensureRecentServer,
  listRecentServers,
  recordRecentServer,
  removeRecentServer,
} from "../lib/recentServers";
import { probeCandidateUrl } from "../lib/reachability";
import { copy } from "../copy";
import { Btn, Field, MachineMark, Notice, Tube } from "../ui/primitives";
import { PasskeySettings } from "./PasskeySettings";
import { DeviceUnlockSettings } from "./DeviceUnlockSettings";
import { SessionSettings } from "./SessionSettings";
import { PasswordSettings } from "./PasswordSettings";

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
  /** Re-run the library load after a URL change. When this address works,
      the app also leaves explicit offline mode (spec 29) — the same exit the
      former "Reconnect to server" button offered. */
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
  onSaved,
  onClose,
}: SettingsProps) {
  const [value, setValue] = useState(getServerUrl());
  const [status, setStatus] = useState<"idle" | "checking" | "ok" | "failed">("idle");
  const [message, setMessage] = useState("");
  const [coversCleared, setCoversCleared] = useState(false);
  /** The saved/recent servers list (spec 40), most recently confirmed first. */
  const [recent, setRecent] = useState<string[]>(() => listRecentServers());
  /** When this build was made, so the phone can say which one it is running. */
  const builtAt = new Date(__BUILD_TIME__).toLocaleString();

  /**
   * Seed the list with the configured server on open, so an address saved
   * before this feature shipped still shows up. Idempotent, and a write that
   * fails (private mode) just leaves the list as it is.
   */
  useEffect(() => {
    const configured = getServerUrl();
    if (configured) setRecent(ensureRecentServer(configured));
  }, []);

  /**
   * Save an address and probe it — the one code path behind both the form's
   * button and a tap on a recent-server entry (spec 40). A probe that passes
   * records the address in the recent list; a failing one records nothing.
   */
  const testAddress = async (address: string) => {
    let saved: string;
    try {
      setServerUrl(address);
      saved = getServerUrl();
    } catch (error) {
      setStatus("failed");
      setMessage(error instanceof Error ? error.message : copy.operator.settings.enterAddress);
      return;
    }

    setStatus("checking");
    setMessage("");
    try {
      // `probeCandidateUrl`, not `requestRaw`: explicit offline mode must not
      // veto the listener asking whether the server is back, or the button
      // reports "The app is in offline mode" for an address it could not
      // even look at.
      const response = await probeCandidateUrl(saved);
      if (!response.ok) throw new Error(copy.operator.serverReplied(response.status));
      setStatus("ok");
      setMessage(copy.operator.settings.connected);
      setRecent(recordRecentServer(saved));
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

  const test = async (event: FormEvent) => {
    event.preventDefault();
    await testAddress(value);
  };

  /** Switch to a past server: fill the field, then run the same save-and-test flow. */
  const switchTo = (address: string) => {
    setValue(address);
    void testAddress(address);
  };

  const forget = (address: string) => {
    setRecent(removeRecentServer(address));
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

          {/*
            Recent servers (spec 40): one tap switches back to a server used
            before. Shown only when there is something to show, and kept
            inside the panel but after the submit flow's message so the
            result of a tap lands where the eye already is. Buttons are
            `type="button"` — inside a form they would submit it.
          */}
          {recent.length > 0 && (
            <div className="border-t-2 border-dashed border-ink/20 pt-3">
              <p className="text-[12px] font-bold uppercase tracking-wide text-ink3">
                {copy.operator.settings.recentHeading}
              </p>
              <p className="mt-0.5 text-[12px] text-ink3">{copy.operator.settings.recentHelp}</p>
              <ul className="mt-2 grid gap-1.5">
                {recent.map((address) => {
                  const isCurrent = address === getServerUrl();
                  return (
                    <li key={address} className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => switchTo(address)}
                        disabled={status === "checking"}
                        className="min-w-0 flex-1 truncate rounded-[10px] border-2 border-ink/15 bg-sunk px-2.5 py-1.5 text-left font-mono text-[12.5px] text-ink2 transition-colors hover:border-ink hover:text-ink disabled:opacity-60"
                      >
                        {address}
                      </button>
                      {isCurrent && (
                        <span className="shrink-0 rounded-full border-2 border-cobalt-ink/40 bg-cobalt/10 px-2 py-0.5 text-[11px] font-bold text-cobalt-ink">
                          {copy.operator.settings.current}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => forget(address)}
                        aria-label={copy.operator.settings.forgetServer(address)}
                        className="shrink-0 rounded-[10px] p-1.5 text-ink3 transition-colors hover:bg-rasp/10 hover:text-rasp-ink"
                      >
                        <X size={15} aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </form>

        <section className="panel mt-4 p-5">
          <h3 className="flex items-center gap-2 font-display text-[17px] font-semibold text-ink">
            <HardDriveDownload size={17} className="text-rasp" aria-hidden="true" />
            {copy.operator.settings.deviceHeading}
          </h3>

          {/* Which build is this? Every APK reports versionName 1.0, so
              without this the phone cannot answer "did my change take?". */}
          <p className="mt-2 text-[12px] text-ink3 tnum">
            {copy.operator.settings.build}: {builtAt}
          </p>

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

          {/* Exiting explicit offline mode is folded into "Save and test"
              above (spec 29): saving an address that answers proves the
              server is back, so there is one obvious control instead of two
              doing similar jobs. */}

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

        <SessionSettings offline={offline} />
        <PasswordSettings offline={offline} />
        <PasskeySettings />
        <DeviceUnlockSettings offline={offline} />
        
        {/* Build version indicator */}
        <section className="mt-6 border-t-2 border-dashed border-ink/20 pt-5">
          <p className="text-center text-xs text-ink3">
            Build: 2026-10-29 11:31 UTC
          </p>
        </section>
      </div>
    </div>
  );
}
