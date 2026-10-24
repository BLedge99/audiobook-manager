import { useEffect, useState } from "react";
import { Fingerprint, LoaderCircle, Trash2 } from "lucide-react";
import { copy } from "../copy";
import { isNativeShell } from "../lib/platform";
import {
  PasskeyError,
  addPasskey,
  listPasskeys,
  passkeysSupported,
  removePasskey,
  type PasskeySummary,
} from "../lib/passkeys";
import { Btn, Notice } from "../ui/primitives";

/**
 * Passkey management (spec 28, phase 6).
 *
 * Web-only by design: the Android app unlocks with the phone's own fingerprint
 * or face sensor instead, so this panel renders nothing inside the shell.
 */
export function PasskeySettings() {
  const supported = passkeysSupported() && !isNativeShell();
  const [passkeys, setPasskeys] = useState<PasskeySummary[] | null>(null);
  const [hidden, setHidden] = useState(!supported);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    if (!supported) return;
    let alive = true;
    void (async () => {
      try {
        const result = await listPasskeys();
        if (!alive) return;
        if (!result.configured) {
          setHidden(true);
          return;
        }
        setPasskeys(result.passkeys);
      } catch {
        if (alive) setHidden(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [supported]);

  if (hidden) return null;

  const add = async () => {
    setBusy(true);
    setMessage(undefined);
    try {
      const credential = await addPasskey();
      setPasskeys((current) => [...(current ?? []), credential]);
      setMessage(copy.security.added);
    } catch (error) {
      setMessage(
        error instanceof PasskeyError && error.code === "passkey_not_configured"
          ? copy.login.passkeyUnavailable
          : copy.security.failed,
      );
      if (error instanceof PasskeyError && error.code === "passkey_not_configured") {
        setHidden(true);
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setMessage(undefined);
    try {
      await removePasskey(id);
      setPasskeys((current) => (current ?? []).filter((entry) => entry.id !== id));
      setMessage(copy.security.removed);
    } catch (error) {
      setMessage(error instanceof PasskeyError ? copy.login.passkeyGone : copy.security.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel mt-4 p-5">
      <h3 className="flex items-center gap-2 font-display text-[17px] font-semibold text-ink">
        <Fingerprint size={17} className="text-rasp" aria-hidden="true" />
        {copy.security.heading}
      </h3>
      <p className="mt-1.5 text-[13.5px] text-ink2">{copy.security.intro}</p>

      {passkeys === null ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-ink2" role="status">
          <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />
          {copy.login.checking}
        </p>
      ) : passkeys.length === 0 ? (
        <p className="mt-3 text-[13.5px] text-ink3">{copy.security.empty}</p>
      ) : (
        <ul className="mt-3 grid gap-2">
          {passkeys.map((passkey) => (
            <li
              key={passkey.id}
              className="flex items-center justify-between gap-3 rounded-[14px_11px_14px_11px/11px_14px_11px_14px] border-2 border-ink/20 px-3 py-2"
            >
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-bold text-ink">
                  {passkey.label ?? copy.security.heading}
                </span>
                <span className="block text-[12px] text-ink3">
                  {passkey.lastUsedAt
                    ? copy.security.lastUsed(new Date(passkey.lastUsedAt).toLocaleDateString())
                    : copy.security.neverUsed}
                </span>
              </span>
              <Btn
                size="sm"
                variant="quiet"
                disabled={busy}
                onClick={() => void remove(passkey.id)}
              >
                <Trash2 size={15} aria-hidden="true" />
                {copy.security.remove}
              </Btn>
            </li>
          ))}
        </ul>
      )}

      {message && (
        <Notice tone="info" role="status" className="mt-3">
          {message}
        </Notice>
      )}

      <Btn type="button" disabled={busy} onClick={() => void add()} className="mt-3">
        {busy ? (
          <>
            <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
            {copy.security.adding}
          </>
        ) : (
          <>
            <Fingerprint size={16} aria-hidden="true" />
            {copy.security.add}
          </>
        )}
      </Btn>
    </section>
  );
}
