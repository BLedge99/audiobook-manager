/**
 * The session probe, as a hook (spec 37, step 4.5).
 *
 * `App.tsx` used to own the probe inline: 68 lines reading six pieces of state
 * and writing six, calling three modules that each had their own notion of
 * "who am I". The probe derived `authed` from the probe **and** from the
 * session fetch -- two sources of truth for one boolean, reconciled only by
 * ordering -- and its re-entrancy guard existed because the probe's own failure
 * triggered a re-probe.
 *
 * The orchestration now lives here; the App supplies the state and the writes,
 * so the module never owns the app's state. The probe reads the account
 * experience through `getAccountExperience` at call time — a captured value
 * went stale the moment `/api/config` flipped the mode after mount.
 */

import { useCallback, useEffect, useRef } from "react";
import { fetchAppConfig, fetchSession, getActiveProfileId, type SessionInfo } from "./api";
import { probeServer as probeServerRequest } from "./reachability";

export interface UseSessionOptions {
  /** The listener's explicit offline choice. */
  offlineModeRef: { current: boolean };
  /** Read the account experience in effect, at call time. */
  getAccountExperience: () => "household" | "demo";
  /** Write the server-reachable state. */
  setServerReachable: (value: boolean | undefined) => void;
  /** Write the authed state. */
  setAuthed: (value: boolean | undefined) => void;
  /** Write the session. */
  setSession: (session: SessionInfo | null) => void;
  /** Clear the remembered session token. */
  setSessionToken: (token: string | null) => void;
  /** Write the stored profile hint. */
  setProfileId: (profileId: string | null) => void;
  /** Write the active profile id. */
  setActiveProfileId: (activeProfileId: string | null) => void;
  /** Write the account experience into the app state. */
  setAccountExperience: (experience: "household" | "demo") => void;
  /** Write the account experience into the api module. */
  setApiAccountExperience: (experience: "household" | "demo") => void;
  /** Write the bypass-server-setup flag. */
  setBypassServerSetup: (value: boolean) => void;
}

export function useSession(options: UseSessionOptions) {
  const {
    offlineModeRef,
    getAccountExperience,
    setServerReachable,
    setAuthed,
    setSession,
    setSessionToken,
    setProfileId,
    setActiveProfileId,
    setAccountExperience,
    setApiAccountExperience,
    setBypassServerSetup,
  } = options;

  const probeInFlight = useRef(false);

  const probeServer = useCallback(async (force = false): Promise<void> => {
    if (offlineModeRef.current && !force) return;
    // One probe at a time. The probe is itself a request, and a request that
    // fails reports the server as unreachable -- so without this guard a
    // failing probe would trigger another probe, for ever.
    if (probeInFlight.current) return;
    probeInFlight.current = true;
    try {
      const config = await fetchAppConfig();
      if (offlineModeRef.current && !force) return;
      setAccountExperience(config.accountExperience);
      setApiAccountExperience(config.accountExperience);
      const probe = await probeServerRequest();
      if (offlineModeRef.current && !force) return;
      setServerReachable(probe.reachable);
      if (probe.reachable) {
        setBypassServerSetup(false);
      }
      if (!probe.reachable) {
        setAuthed(false);
        setProfileId(getAccountExperience() === "demo" ? null : getActiveProfileId());
        return;
      }
      if (!probe.authed) {
        setAuthed(false);
        setSession(null);
        setSessionToken(null);
        return;
      }
      const info = await fetchSession();
      if (offlineModeRef.current && !force) return;
      if (!info) {
        setAuthed(false);
        setSession(null);
        setSessionToken(null);
        return;
      }
      setSession(info);
      setAuthed(true);
      if (config.accountExperience === "demo") {
        setProfileId(null);
        setActiveProfileId(null);
        if (info.profile) {
          setSession({ ...info, profile: { email: info.profile.email }, role: "member" });
        }
      } else if (info.profile) {
        const id = String(info.profile.id);
        setProfileId(id);
        setActiveProfileId(id);
      } else if (info.via === "household") {
        setProfileId(getAccountExperience() === "demo" ? null : getActiveProfileId());
      }
    } catch (error) {
      console.error("Could not complete server probe.", error);
      setServerReachable(false);
      setAuthed(false);
      setProfileId(getAccountExperience() === "demo" ? null : getActiveProfileId());
    } finally {
      probeInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void probeServer();
  }, [probeServer]);

  return { probeServer };
}
