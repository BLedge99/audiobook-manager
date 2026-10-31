import { useEffect, useState } from "react";
import { Fingerprint } from "lucide-react";
import { copy } from "../copy";
import { boundedFetch, getActiveProfileId } from "../lib/api";
import { biometricVault } from "../lib/biometricVault";
import { activeCacheKey, exportActiveProfileKey, toBase64 } from "../local/privateCache";
import { Btn, Notice } from "../ui/primitives";

interface DeviceRecord { id: string; label: string | null }

export function DeviceUnlockSettings({ offline = false }: { offline?: boolean }) {
  const [available, setAvailable] = useState(false);
  const [checked, setChecked] = useState(false);
  const [vaultSaved, setVaultSaved] = useState(false);
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [profileId, setProfileId] = useState(() => Number(getActiveProfileId()));

  const refresh = async () => {
    const currentProfileId = Number(getActiveProfileId());
    if (Number.isInteger(currentProfileId) && currentProfileId > 0) setProfileId(currentProfileId);
    if (!biometricVault.supported() || !Number.isInteger(currentProfileId) || currentProfileId < 1) {
      setChecked(true);
      return;
    }
    setAvailable(await biometricVault.available());
    setVaultSaved(await biometricVault.hasSavedValue(currentProfileId));
    setChecked(true);
    try {
      const response = await boundedFetch("/api/auth/devices");
      if (response.ok) setDevices(((await response.json()) as { devices: DeviceRecord[] }).devices);
    } catch { /* The password route remains available offline. */ }
  };
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const currentProfileId = Number(getActiveProfileId());
      if (!biometricVault.supported()) return;
      setAvailable(await biometricVault.available());
      if (!alive) return;
      if (!Number.isInteger(currentProfileId) || currentProfileId < 1) {
        setChecked(true);
        return;
      }
      setProfileId(currentProfileId);
      setVaultSaved(await biometricVault.hasSavedValue(currentProfileId));
      if (!alive) return;
      setChecked(true);
      try {
        const response = await boundedFetch("/api/auth/devices");
        if (response.ok && alive) setDevices(((await response.json()) as { devices: DeviceRecord[] }).devices);
      } catch { /* The password route remains available offline. */ }
    };
    void load();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (Number(getActiveProfileId()) !== profileId) void refresh();
    }, 250);
    return () => window.clearInterval(timer);
  }, [profileId]);

  const enable = async () => {
    setBusy(true); setMessage("");
    let id: string | undefined;
    try {
      const key = await exportActiveProfileKey(profileId);
      if (!key) throw new Error(offline ? copy.security.deviceNeedsPasswordOffline : copy.security.deviceNeedsPassword);
      
      // Offline mode: save key directly without server registration
      if (offline) {
        await biometricVault.save(profileId, { profileId, key: toBase64(key) });
        setMessage(copy.security.deviceReady);
        await refresh();
        return;
      }
      
      // Online mode: register device with server and save both secret and key
      const response = await boundedFetch("/api/auth/devices", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: copy.security.thisDevice }),
      });
      if (!response.ok) throw new Error(copy.login.deviceFailed);
      const created = (await response.json()) as { id: string; secret: string };
      id = created.id;
      await biometricVault.save(profileId, { profileId, secret: created.secret, key: toBase64(key) });
      setMessage(copy.security.deviceReady);
      await refresh();
    } catch (error) {
      if (id) await boundedFetch(`/api/auth/devices/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => undefined);
      setMessage(error instanceof Error ? error.message : copy.login.deviceFailed);
    } finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      const response = await boundedFetch(`/api/auth/devices/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(copy.login.deviceFailed);
      await biometricVault.clear(profileId);
      await refresh();
      setMessage(copy.security.deviceRemoved);
    } catch (error) { setMessage(error instanceof Error ? error.message : copy.login.deviceFailed); }
    finally { setBusy(false); }
  };

  if (!biometricVault.supported() || !checked) return null;

  /*
   * The sensor is missing or nothing is enrolled. The old code returned null
   * here, which left a silent gap where the control should be -- and no way to
   * learn that enrolling a fingerprint in Android Settings is what turns this
   * on. Spec 29 asks for the explanation instead of the gap.
   */
  if (!available) {
    return (
      <section className="mt-6 border-t-2 border-dashed border-ink/20 pt-5" aria-labelledby="device-unlock-heading">
        <h2 id="device-unlock-heading" className="font-display text-xl font-semibold text-ink">{copy.security.deviceHeading}</h2>
        <p className="mt-1 text-sm text-ink2">{copy.security.deviceUnavailable}</p>
      </section>
    );
  }

  if (!Number.isInteger(profileId) || profileId < 1) {
    return (
      <section className="mt-6 border-t-2 border-dashed border-ink/20 pt-5" aria-labelledby="device-unlock-heading">
        <h2 id="device-unlock-heading" className="font-display text-xl font-semibold text-ink">{copy.security.deviceHeading}</h2>
        <p className="mt-1 text-sm text-ink2">{copy.security.deviceNeedsPassword}</p>
      </section>
    );
  }

  return (
    <section className="mt-6 border-t-2 border-dashed border-ink/20 pt-5" aria-labelledby="device-unlock-heading">
      <h2 id="device-unlock-heading" className="font-display text-xl font-semibold text-ink">{copy.security.deviceHeading}</h2>
      <p className="mt-1 text-sm text-ink2">{offline ? copy.security.deviceIntroOffline : copy.security.deviceIntro}</p>
      {devices.map((device) => <div key={device.id} className="mt-3 flex items-center justify-between gap-3 rounded-xl border-2 border-ink/20 p-3">
        <span>{device.label || copy.security.deviceHeading}</span>
        <Btn size="sm" variant="quiet" disabled={busy} onClick={() => void remove(device.id)}>{copy.security.remove}</Btn>
      </div>)}
      {(!vaultSaved || (!offline && devices.length === 0)) && <Btn className="mt-3" disabled={busy || !activeCacheKey(profileId)} onClick={() => void enable()}>
        <Fingerprint size={16} aria-hidden="true" /> {busy ? copy.security.adding : (offline ? copy.security.deviceEnableOffline : copy.security.deviceEnable)}
      </Btn>}
      {message && <Notice className="mt-3" role="status">{message}</Notice>}
    </section>
  );
}
