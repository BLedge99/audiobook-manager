import { useCallback, useEffect, useState } from "react";
import { copy } from "../copy";
import { boundedFetch } from "../lib/api";
import { Btn, Notice } from "../ui/primitives";

/**
 * The devices this profile is signed in on (spec 36).
 *
 * This used to list **sessions**, one row per sign-in, so an Android phone
 * that signed in once a day appeared once a day. The server now lists
 * **devices**: one row per phone or browser, with the number of live sign-ins
 * it holds, and a single action to clear the rest.
 */
interface DeviceRecord {
  key: string;
  label: string | null;
  createdAt: string;
  lastActiveAt: string;
  current: boolean;
  sessions: number;
}

function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

export function SessionSettings({ offline = false }: { offline?: boolean }) {
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyAll, setBusyAll] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await boundedFetch("/api/auth/sessions");
      if (!response.ok) throw new Error("devices unavailable");
      setDevices(((await response.json()) as { devices: DeviceRecord[] }).devices);
      setMessage("");
    } catch {
      setMessage(copy.security.sessionsFailed);
    }
  }, []);

  useEffect(() => {
    if (!offline) void refresh();
  }, [offline, refresh]);

  const signOut = async (key: string) => {
    setBusyId(key);
    setMessage("");
    try {
      const response = await boundedFetch(
        `/api/auth/sessions/device/${encodeURIComponent(key)}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error("device sign out failed");
      setDevices((current) => current.filter((device) => device.key !== key));
      setMessage(copy.security.sessionRevoked);
    } catch {
      setMessage(copy.security.deviceSignOutFailed);
    } finally {
      setBusyId(null);
    }
  };

  const signOutOthers = async () => {
    setBusyAll(true);
    setMessage("");
    try {
      const response = await boundedFetch("/api/auth/sessions/others", { method: "DELETE" });
      if (!response.ok) throw new Error("sign out failed");
      await refresh();
      setMessage(copy.security.otherDevicesSignedOut);
    } catch {
      setMessage(copy.security.deviceSignOutFailed);
    } finally {
      setBusyAll(false);
    }
  };

  if (offline) return null;
  const others = devices.filter((device) => !device.current);
  return (
    <section className="mt-6 border-t-2 border-dashed border-ink/20 pt-5" aria-labelledby="sessions-heading">
      <h2 id="sessions-heading" className="font-display text-xl font-semibold text-ink">{copy.security.sessionsHeading}</h2>
      <p className="mt-1 text-sm text-ink2">{copy.security.sessionsIntro}</p>
      {devices.map((device) => (
        <div key={device.key} className="mt-3 flex items-center justify-between gap-3 rounded-xl border-2 border-ink/20 p-3">
          <div className="min-w-0">
            <p className="truncate font-semibold text-ink">{device.label || (device.current ? copy.security.thisDevice : copy.security.otherDevice)}</p>
            <p className="text-xs text-ink3">{copy.security.lastActive(dateLabel(device.lastActiveAt))}</p>
            {device.sessions > 1 && (
              <p className="text-xs text-ink3">{copy.security.deviceSignedInTimes(device.sessions)}</p>
            )}
          </div>
          {!device.current && (
            <Btn
              size="sm"
              variant="quiet"
              disabled={busyId !== null || busyAll}
              onClick={() => void signOut(device.key)}
            >
              {copy.security.signOutDevice}
            </Btn>
          )}
        </div>
      ))}
      {others.length > 0 && (
        <Btn
          className="mt-3"
          variant="quiet"
          size="sm"
          disabled={busyId !== null || busyAll}
          onClick={() => void signOutOthers()}
        >
          {copy.security.signOutOtherDevices}
        </Btn>
      )}
      {message && <Notice className="mt-3" role="status">{message}</Notice>}
    </section>
  );
}
