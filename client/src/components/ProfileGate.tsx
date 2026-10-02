import { type FormEvent, useEffect, useState } from "react";

interface Profile {
  id: number;
  name: string;
  color?: string | null;
}

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
    const res = await fetch("/api/profiles");
    if (res.ok) setProfiles(await res.json());
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
      setError("Could not create profile");
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-[#0b1117] text-slate-100">
      <div className="w-full max-w-sm border border-slate-800 bg-slate-900 p-8">
        <h1 className="mb-1 text-xl font-bold">Who's listening?</h1>
        <p className="mb-6 text-sm text-slate-400">Pick your profile so your progress is saved separately from the rest of the household.</p>
        <div className="mb-4 grid gap-2">
          {profiles.map((profile) => (
            <button
              key={profile.id}
              type="button"
              onClick={() => select(profile.id)}
              className="border border-slate-700 bg-slate-950 px-4 py-3 text-left font-semibold text-slate-100 hover:border-cyan-400 hover:text-cyan-300"
            >
              {profile.name}
            </button>
          ))}
          {!profiles.length && <p className="text-sm text-slate-500">No profiles yet — create one below.</p>}
        </div>
        {showAdd ? (
          <form onSubmit={add} className="mb-4 flex items-center gap-1">
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Name"
              className="w-full border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-cyan-400"
            />
            <button type="submit" className="shrink-0 bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-white">Add</button>
          </form>
        ) : (
          <button type="button" onClick={() => setShowAdd(true)} className="mb-4 text-sm text-cyan-400 hover:text-cyan-300">+ Add profile</button>
        )}
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      </div>
    </div>
  );
}
