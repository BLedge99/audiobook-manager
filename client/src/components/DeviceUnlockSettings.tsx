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
  const [vaultSaved, setVaultSaved] = useState(false);
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const profileId = Number(getActiveProfileId());

  const refresh = async () => {
    if (!biometricVault.supported() || !Number.isInteger(profileId) || profileId < 1) return;
    setAvailable(await biometricVault.available());
    setVaultSaved(await biometricVault.hasSavedValue());
    try {
      const response = await boundedFetch("/api/auth/devices");
      if (response.ok) setDevices(((await response.json()) as { devices: DeviceRecord[] }).devices);
    } catch { /* The password route remains available offline. */ }
  };
  useEffect(() => { void refresh(); }, []);

  const enable = async () => {
    setBusy(true); setMessage("");
    let id: string | undefined;
    try {
      const key = await exportActiveProfileKey(profileId);
      if (!key) throw new Error(copy.security.deviceNeedsPassword);
      const response = await boundedFetch("/api/auth/devices", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: copy.security.thisDevice }),
      });
      if (!response.ok) throw new Error(copy.login.deviceFailed);
      const created = (await response.json()) as { id: string; secret: string };
      id = created.id;
      await biometricVault.save({ profileId, secret: created.secret, key: toBase64(key) });
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
      await biometricVault.clear();
      await refresh();
      setMessage(copy.security.deviceRemoved);
    } catch (error) { setMessage(error instanceof Error ? error.message : copy.login.deviceFailed); }
    finally { setBusy(false); }
  };

  if (offline || !biometricVault.supported() || !available) return null;
  return (
    <section className="mt-6 border-t-2 border-dashed border-ink/20 pt-5" aria-labelledby="device-unlock-heading">
      <h2 id="device-unlock-heading" className="font-display text-xl font-semibold text-ink">{copy.security.deviceHeading}</h2>
      <p className="mt-1 text-sm text-ink2">{copy.security.deviceIntro}</p>
      {devices.map((device) => <div key={device.id} className="mt-3 flex items-center justify-between gap-3 rounded-xl border-2 border-ink/20 p-3">
        <span>{device.label || copy.security.deviceHeading}</span>
        <Btn size="sm" variant="quiet" disabled={busy} onClick={() => void remove(device.id)}>{copy.security.remove}</Btn>
      </div>)}
      {!vaultSaved && <Btn className="mt-3" disabled={busy || !activeCacheKey(profileId)} onClick={() => void enable()}>
        <Fingerprint size={16} aria-hidden="true" /> {busy ? copy.security.adding : copy.security.deviceEnable}
      </Btn>}
      {message && <Notice className="mt-3" role="status">{message}</Notice>}
    </section>
  );
}
