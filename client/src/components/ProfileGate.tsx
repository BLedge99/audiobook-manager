import { type FormEvent, useEffect, useState } from "react";
import { Plus, UserRound } from "lucide-react";
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
export function ProfileGate({ onSuccess }: { onSuccess: () => void }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [newName, setNewName] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState("");

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
        setError("Session expired. Reload the app to sign in again.");
      } else {
        setError(`Could not load profiles (HTTP ${res.status}).`);
      }
    } catch (loadError) {
      setError(
        `Cannot reach the server. ${loadError instanceof Error ? loadError.message : "Check the server address in Settings."}`,
      );
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
      setError("A profile with that name already exists");
      return;
    }
    setError("");
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
        setError("A profile with that name already exists");
      } else {
        setError(`Could not create profile (HTTP ${res.status}).`);
      }
    } catch (addError) {
      // Without this the form simply stopped working on any network failure.
      setError(
        `Could not create the profile. ${addError instanceof Error ? addError.message : "Check the server address in Settings."}`,
      );
    }
  };

  return (
    <FullScreen>
      <div className="flex flex-col items-center">
        <Wordmark title="Audiobook Manager" subtitle="local-first listening" />

        <div className="panel mt-8 w-full max-w-sm px-6 py-7">
          {/* The straight apostrophe is load-bearing: `e2e/helpers.ts` matches
              this heading by exact accessible name, and a typographic one makes
              the whole suite fail to pick a profile. */}
          <h1 className="font-display text-2xl font-semibold text-ink">Who's listening?</h1>
          <p className="mt-1.5 text-sm text-ink2">
            Pick your profile so your progress is saved separately from the rest of the household.
          </p>

          <div className="mt-5 grid gap-3">
            {profiles.map((profile, index) => (
              <button
                key={profile.id}
                type="button"
                onClick={() => select(profile.id)}
                className={cn(
                  "capsule flex items-center gap-3 px-4 py-3 text-left",
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
                <span className="min-w-0 truncate font-display text-[17px] font-semibold text-ink">
                  {profile.name}
                </span>
              </button>
            ))}
            {!profiles.length && (
              <p className="panel panel--sunk px-4 py-5 text-center text-sm text-ink2">
                No profiles yet — create one below.
              </p>
            )}
          </div>

          {showAdd ? (
            <form onSubmit={add} className="mt-4 flex items-center gap-2">
              <Field
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="Name"
                aria-label="New profile name"
                className="min-w-0 flex-1"
              />
              <Btn type="submit" className="shrink-0">Add</Btn>
            </form>
          ) : (
            <Btn variant="quiet" size="sm" onClick={() => setShowAdd(true)} className="mt-4">
              <Plus size={16} aria-hidden="true" /> + Add profile
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