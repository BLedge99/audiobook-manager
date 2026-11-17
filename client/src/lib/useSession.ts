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
import { WAKE_TIMEOUT_MS } from "./wakeBudget";
import { isDemoExperience } from "../local/experience";

/** Stable identity for the setServerWaking default argument. */
const STABLE_NOOP_SETTER = () => undefined;

export interface UseSessionOptions {
  /** The listener's explicit offline choice. */
  offlineModeRef: { current: boolean };
  /** Read the account experience in effect, at call time. */
  getAccountExperience: () => "household" | "demo";
  /** Write the server-reachable state. */
  setServerReachable: (value: boolean | undefined) => void;
  /** A slow-wake probe is in flight. Absent callers tolerate a no-op. */
  setServerWaking?: (value: boolean) => void;
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
  const setServerWaking = options.setServerWaking ?? STABLE_NOOP_SETTER;

  // "demo" sessions carry no household profile id; everything else does.
  const resolveSessionProfileId = useCallback(
    () => (isDemoExperience(getAccountExperience()) ? null : getActiveProfileId()),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reason: inline arrow over a ref; read at resolution time sees the current value
    [],
  );

  const probeInFlight = useRef(false);
  // Incremented whenever a forced probe supersedes whatever is in flight, so
  // the stale probe can notice it lost and write nothing.
  const probeGeneration = useRef(0);

  const probeServer = useCallback(async (force = false): Promise<void> => {
    if (offlineModeRef.current && !force) return;
    // One probe at a time — unless the listener asked for another. A force
    // cancels whatever is in flight: the stalled wake is the reason Retry was
    // tapped, and the feedback they expect is a fresh attempt, not silence.
    if (probeInFlight.current && !force) return;
    if (force) probeGeneration.current += 1;
    const generation = probeGeneration.current;
    const stillCurrent = () => probeGeneration.current === generation;
    probeInFlight.current = true;
    try {
      const config = await fetchAppConfig();
      if (!stillCurrent()) return; // a forced probe superseded this one
      if (offlineModeRef.current && !force) return;
      setAccountExperience(config.accountExperience);
      setApiAccountExperience(config.accountExperience);
      let probe = await probeServerRequest();
      // The fast probe has failed: the server may be asleep rather
      // than absent. On a free tier, the wake takes the better part of a
      // minute, so there is a second, patient probe — and while it runs the
      // UI shows "waking", because the listener's tap must not look like it
      // went nowhere.
      if (!probe.reachable) {
        if (!stillCurrent()) return;
        setServerWaking(true);
        probe = await probeServerRequest(WAKE_TIMEOUT_MS);
        if (!stillCurrent()) return; // a forced probe owns the waking state now
        setServerWaking(false);
      }
      if (!stillCurrent()) return;
      if (offlineModeRef.current && !force) return;
      setServerReachable(probe.reachable);
      if (probe.reachable) {
        setBypassServerSetup(false);
      }
      if (!probe.reachable) {
        setAuthed(false);
        setProfileId(resolveSessionProfileId());
        return;
      }
      if (!probe.authed) {
        setAuthed(false);
        setSession(null);
        setSessionToken(null);
        return;
      }
      const info = await fetchSession();
      if (!stillCurrent()) return;
      if (offlineModeRef.current && !force) return;
      if (!info) {
        setAuthed(false);
        setSession(null);
        setSessionToken(null);
        return;
      }
      setSession(info);
      setAuthed(true);
      if (isDemoExperience(config.accountExperience)) {
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
        setProfileId(resolveSessionProfileId());
      }
    } catch (error) {
      if (!stillCurrent()) return;
      console.error("Could not complete server probe.", error);
      setServerReachable(false);
      setAuthed(false);
      setProfileId(resolveSessionProfileId());
    } finally {
      if (stillCurrent()) probeInFlight.current = false;
    }
  }, [
    offlineModeRef,
    resolveSessionProfileId,
    setServerWaking,
    setAuthed,
    setSession,
    setSessionToken,
    setProfileId,
    setActiveProfileId,
    setAccountExperience,
    setApiAccountExperience,
    setBypassServerSetup,
    setServerReachable,
  ]);

  useEffect(() => {
    void probeServer();
  }, [probeServer]);

  // Unlocking the phone is the moment the sleeping instance needs waking: the
  // tap is not user-visible, but the server was asleep while the screen was
  // off and must spin up before anything else can work. The probe honours
  // offline mode and reports truthfully either way.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") void probeServer();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [probeServer]);

  return { probeServer };
}
