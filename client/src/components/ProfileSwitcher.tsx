import { type FormEvent, useEffect, useState } from "react";

interface Profile {
  id: number;
  name: string;
  color?: string | null;
}

export function ProfileSwitcher() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(() => window.localStorage.getItem("profileId"));
  const [newName, setNewName] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const load = async () => {
    const res = await fetch("/api/profiles");
    if (res.ok) setProfiles(await res.json());
  };

  useEffect(() => { void load(); }, []);

  const select = (id: number) => {
    window.localStorage.setItem("profileId", String(id));
    setCurrentId(String(id));
    window.location.reload();
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!newName.trim()) return;
    const res = await fetch("/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    if (res.ok) {
      const profile = await res.json();
      setNewName("");
      setShowAdd(false);
      await load();
      select(profile.id);
    }
  };

  const remove = async (id: number) => {
    await fetch(`/api/profiles/${id}`, { method: "DELETE" });
    if (String(id) === currentId) {
      window.localStorage.removeItem("profileId");
      setCurrentId(null);
    }
    await load();
  };

  return (
    <div className="flex items-center gap-2 text-sm">
      <select
        aria-label="Active profile"
        value={currentId ?? ""}
        onChange={(event) => event.target.value && select(Number(event.target.value))}
        className="border border-slate-700 bg-slate-950 px-2 py-1 text-slate-200"
      >
        <option value="" disabled>Select profile</option>
        {profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>{profile.name}</option>
        ))}
      </select>
      <button type="button" onClick={() => setShowAdd((v) => !v)} className="text-cyan-400 hover:text-cyan-300">+ Profile</button>
      {currentId && (
        <button type="button" onClick={() => void remove(Number(currentId))} className="text-slate-500 hover:text-red-400">Delete</button>
      )}
      {showAdd && (
        <form onSubmit={add} className="flex items-center gap-1">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name" className="w-28 border border-slate-700 bg-slate-950 px-2 py-1" />
          <button type="submit" className="bg-slate-100 px-2 py-1 text-slate-950">Add</button>
        </form>
      )}
    </div>
  );
}
