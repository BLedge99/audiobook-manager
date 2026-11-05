import { type FormEvent, useEffect, useState } from "react";
import { Plus, UserRound } from "lucide-react";
import { copy } from "../copy";
import { Btn, Field, FullScreen, Wordmark, cn } from "../ui/primitives";

interface Profile {
  id: number;
  name: string;
  color?: string | null;
}

/** Shell tints for profile capsules, picked by position so a household always
 *  sees the same person in the same colour. */
const CAPSULE_TINTS = ["var(--rasp)", "var(--tan)", "var(--cobalt)", "var(--mint)"];

/**
 * Shown when the household password is accepted but no profile is
 * selected (first launch, or localStorage was cleared). Progress is
 * profile-scoped, so listening must not start without one.
 */
export function ProfileGate({
  onSuccess,
  onContinueOffline,
}: {
  onSuccess: () => void;
  /** Offered in the native shell so the listener is never soft-locked offline. */
  onContinueOffline?: () => void;
}) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [newName, setNewName] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState("");
  const [householdPassword, setHouseholdPassword] = useState("");
  const [creatingOffline, setCreatingOffline] = useState(false);

  const load = async () => {
    // Guarded because `fetch` rejects on a network or CORS failure, and an
    // unhandled rejection here left the screen looking like it had done nothing
    // at all: the Add button appeared dead, with no message anywhere. On the
    // Android app that is the *first* thing a new user sees, and the most likely
    // failure is "cannot reach the server", which they cannot diagnose unaided.
    try {
      const res = await fetch("/api/profiles");
      if (res.ok) {
        setProfiles(await res.json());
        setError("");
      } else if (res.status === 401) {
        // If unauthorized, show empty list with creation option
        // instead of blocking error
        setProfiles([]);
        setError("");
      } else {
        // Other errors - still allow profile creation
        setProfiles([]);
        setError("");
      }
    } catch (loadError) {
      // Network failure - allow offline profile creation
      setProfiles([]);
      setError("");
    }
  };

  useEffect(() => { void load(); }, []);

  const select = (id: number) => {
    window.localStorage.setItem("profileId", String(id));
    onSuccess();
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    if (profiles.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      setError(copy.profile.duplicate);
      return;
    }
    setError("");
    
    // Check if we should create offline (no network)
    const isOffline = !navigator.onLine;
    if (isOffline) {
      setCreatingOffline(true);
      // Create a temporary profile locally
      const tempId = -Date.now(); // Negative ID indicates offline profile
      const offlineProfile: Profile = { id: tempId, name };
      setProfiles([...profiles, offlineProfile]);
      // Store household password for offline validation when reconnecting
      try {
        window.localStorage.setItem(`offlineProfile_${tempId}`, JSON.stringify({ name, householdPassword }));
      } catch {
        // Private mode / storage disabled
      }
      select(tempId);
      return;
    }

    try {
      const res = await fetch("/api/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const profile = await res.json();
        setNewName("");
        setShowAdd(false);
        await load();
        select(profile.id);
      } else if (res.status === 409) {
        setError(copy.profile.duplicate);
      } else {
        setError(copy.profile.createFailed(res.status));
      }
    } catch (addError) {
      // Fall back to offline creation if network fails
      setCreatingOffline(true);
      const tempId = -Date.now();
      const offlineProfile: Profile = { id: tempId, name };
      setProfiles([...profiles, offlineProfile]);
      try {
        window.localStorage.setItem(`offlineProfile_${tempId}`, JSON.stringify({ name, householdPassword }));
      } catch {
        // Private mode / storage disabled
      }
      select(tempId);
    }
  };

  return (
    <FullScreen>
      <div className="flex flex-col items-center">
        <Wordmark title={copy.brand.name} subtitle={copy.brand.tagline} />

        <div className="panel mt-8 w-full min-w-0 max-w-sm px-4 py-6 sm:px-6 sm:py-7">
          {/* The straight apostrophe is load-bearing: `e2e/helpers.ts` matches
              this heading by exact accessible name, and a typographic one makes
              the whole suite fail to pick a profile. */}
          <h1 className="font-display text-2xl font-semibold text-ink">{copy.profile.heading}</h1>
          <p className="mt-1.5 text-sm text-ink2">{copy.profile.intro}</p>

          <div className="mt-5 grid min-w-0 gap-3">
            {profiles.map((profile, index) => (
              <button
                key={profile.id}
                type="button"
                onClick={() => select(profile.id)}
                className={cn(
                  "capsule flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left",
                  index % 2 ? "capsule--alt" : "",
                )}
              >
                <span
                  aria-hidden="true"
                  className="grid size-10 shrink-0 place-items-center rounded-full border-2 border-ink"
                  style={{ background: profile.color ?? CAPSULE_TINTS[index % CAPSULE_TINTS.length] }}
                >
                  <UserRound size={18} className="text-white" />
                </span>
                <span className="min-w-0 flex-1 truncate font-display text-[17px] font-semibold text-ink">
                  {profile.name}
                </span>
              </button>
            ))}
            {!profiles.length && !showAdd && (
              <div className="panel panel--sunk px-4 py-5 text-center">
                <p className="text-sm text-ink2 mb-3">{copy.profile.noneYet}</p>
                <Btn variant="quiet" size="sm" onClick={() => setShowAdd(true)}>
                  <Plus size={16} aria-hidden="true" /> {copy.profile.createFirst}
                </Btn>
              </div>
            )}
          </div>

          {showAdd ? (
            <form onSubmit={add} className="mt-4 flex flex-col gap-2">
              <Field
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder={copy.profile.namePlaceholder}
                aria-label={copy.profile.nameLabel}
                className="min-w-0 flex-1"
              />
              {creatingOffline && (
                <Field
                  type="password"
                  value={householdPassword}
                  onChange={(event) => setHouseholdPassword(event.target.value)}
                  placeholder={copy.login.passwordPlaceholder}
                  aria-label={copy.login.passwordLabel}
                  className="min-w-0 flex-1"
                />
              )}
              <Btn type="submit" className="shrink-0">{copy.profile.addShort}</Btn>
            </form>
          ) : (
            <Btn variant="quiet" size="sm" onClick={() => setShowAdd(true)} className="mt-4">
              <Plus size={16} aria-hidden="true" /> {copy.profile.addProfile}
            </Btn>
          )}

          {onContinueOffline && (
            <Btn
              type="button"
              variant="quiet"
              onClick={onContinueOffline}
              className="mt-4 w-full"
            >
              {copy.operator.serverSetup.continueOffline}
            </Btn>
          )}

          {error && (
            <p role="alert" className="mt-3 rounded-[14px_11px_14px_11px/11px_14px_11px_14px] border-2 border-ink bg-rasp/12 px-3 py-2 text-sm font-bold text-rasp-ink">
              {error}
            </p>
          )}
        </div>
      </div>
    </FullScreen>
  );
}