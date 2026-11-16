/**
 * Profile-cache discovery and the offline-skip reset (spec 43 phase 6.2,
 * extract-only).
 *
 * Two questions, two effects:
 *
 *   1. "Does this device hold anything for a known profile?" — the discovery
 *      effect adopts the single cached profile as the break-glass hint when
 *      nothing is selected, so a phone that only ever saw one listener does
 *      not open onto an empty profile gate.
 *   2. "What can this device prove it holds for the *active* profile?" — the
 *      watcher effect (spec 29): the password envelope in `keyEnvelopes` or the
 *      native biometric Vault. Checking only the envelope told a fingerprint
 *      listener that "no protected profile data" existed while the books and
 *      the key were both on the phone.
 *
 * The offline unlock decision itself stays in `lib/offlineGate.ts`; this file
 * only produces the inputs it reads.
 */
import { useEffect, useState } from "react";
import {
  activeCacheProfileId,
  hasProfileCache,
  listCachedProfileIds,
  offlineCacheState,
} from "../local/privateCache";
import { biometricVault } from "./biometricVault";
import { setActiveProfileId, getActiveProfileIdNumber } from "./api";
import type { CacheState } from "./offlineGate";

export interface ProfileCacheInput {
  /** `undefined` until the first probe answers; `false` when unreachable. */
  serverReachable: boolean | undefined;
  /** The shelf profile derived at render time. */
  activeProfileId: string | null;
  /** The break-glass hint state setter from App. */
  setProfileId: (id: string | null) => void;
}

export function useProfileCache({ serverReachable, activeProfileId, setProfileId }: ProfileCacheInput) {
  const [cacheState, setCacheState] = useState<CacheState>("unknown");
  /** Whether progress and favourites can actually be read offline on this screen. */
  const [offlineUnlocked, setOfflineUnlocked] = useState<boolean>(() => {
    const id = getActiveProfileIdNumber();
    return id !== null && activeCacheProfileId() === id;
  });
  const [skippedUnlock, setSkippedUnlock] = useState(false);

  /**
   * Decide whether offline can be opened at all.
   *
   * Downloads without an envelope are not private data we can show. The app
   * says so instead of falling through on a stale localStorage profile.
   */
  useEffect(() => {
    if (activeProfileId) return;
    let alive = true;
    void listCachedProfileIds().then((ids) => {
      if (!alive) return;
      if (ids.length === 1) {
        const id = String(ids[0]);
        setActiveProfileId(id);
        setProfileId(id);
      }
    });
    return () => {
      alive = false;
    };
  }, [activeProfileId, setProfileId]);

  /**
   * What this device can prove it holds for the active profile (spec 29).
   *
   * Two things count: the password-wrapped envelope in `keyEnvelopes`, or the
   * native biometric Vault, which stores the DEK itself and therefore never
   * writes an envelope.
   */
  useEffect(() => {
    if (serverReachable !== false || !activeProfileId) {
      setCacheState("unknown");
      return;
    }
    const id = Number(activeProfileId);
    if (!Number.isInteger(id) || id < 1) {
      setCacheState("absent");
      setOfflineUnlocked(false);
      return;
    }
    // The key is already in memory: no need to ask IndexedDB or the Vault.
    if (activeCacheProfileId() === id) {
      setCacheState("present");
      setOfflineUnlocked(true);
      return;
    }

    let alive = true;
    void Promise.all([
      hasProfileCache(id),
      // A plain `contains()` on SharedPreferences, so it stays true even for a
      // value the Keystore can no longer decrypt. That is still enough to
      // *offer* the unlock screen: OfflineUnlock classifies the failure and
      // offers two exits, so a stale value is recoverable there.
      biometricVault.hasSavedValue(id).catch(() => false),
    ]).then(([hasEnvelope, vaultSaved]) => {
      if (!alive) return;
      setCacheState(offlineCacheState(hasEnvelope, vaultSaved));
      setOfflineUnlocked(false);
    });
    return () => {
      alive = false;
    };
  }, [serverReachable, activeProfileId]);

  // A skip lasts for this offline session only. Reconnecting, or switching who
  // is listening, is a fresh decision — and a fresh opportunity to save
  // progress.
  useEffect(() => {
    if (serverReachable !== false) setSkippedUnlock(false);
  }, [serverReachable]);

  useEffect(() => {
    setSkippedUnlock(false);
  }, [activeProfileId]);

  return { cacheState, offlineUnlocked, setOfflineUnlocked, skippedUnlock, setSkippedUnlock };
}
