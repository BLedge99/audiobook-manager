import { type FormEvent, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { copy } from "../copy";
import { Btn, Field, cn } from "../ui/primitives";

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
  const [error, setError] = useState("");

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
    const name = newName.trim();
    if (!name) return;
    if (profiles.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      setError(copy.profile.duplicate);
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
      setError(copy.profile.duplicate);
    }
  };

  const remove = async (id: number) => {
    await fetch(`/api/profiles/${id}`, { method: "DELETE" });
    if (String(id) === currentId) {
      window.localStorage.removeItem("profileId");
      setCurrentId(null);
      // Reload like `select` does. Without it the app keeps the deleted id
      // in state, so the profile gate never reappears and every progress save
      // is rejected by the server with no visible error.
      window.location.reload();
      return;
    }
    await load();
  };

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
      {/* Stays a native <select>: the E2E suite reads the chosen option by
          `option:checked` to confirm the switch took effect.

          `max-w-[9rem]` because a long profile name ("Harry Potter and the
          Goblet of Fire") made this select 130px+ wide, and it is one of three
          fixed-width items in the header row that used to force the whole page
          sideways on a phone. `min-w-0` and the width cap are load-bearing --
          `e2e/phone-layout` fails without them. */}
      <select
        aria-label={copy.profile.switcherLabel}
        value={currentId ?? ""}
        onChange={(event) => event.target.value && select(Number(event.target.value))}
        className={cn(
          "min-w-0 max-w-[7.5rem] truncate rounded-[14px_11px_14px_11px/11px_14px_11px_14px] border-2 border-ink bg-surface sm:max-w-[9rem]",
          "px-2.5 py-1.5 text-[13px] font-bold text-ink",
        )}
      >
        <option value="" disabled>{copy.profile.selectProfile}</option>
        {profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>{profile.name}</option>
        ))}
      </select>

      {/* Add and Delete live in Settings on a phone. Keeping them here put three rows
          of chrome above the shelf on a 390px screen; the profile select alone
          is enough to switch, and both actions remain reachable from the
          Settings sheet. The E2E suite drives them at desktop width. */}
      <Btn variant="quiet" size="sm" onClick={() => setShowAdd((v) => !v)} className="hidden sm:inline-flex">
        {copy.profile.addProfileCompact}
      </Btn>

      {currentId && (
        <Btn
          variant="quiet"
          size="sm"
          onClick={() => void remove(Number(currentId))}
          aria-label={copy.profile.deleteActive}
          className="hidden text-rasp-ink sm:inline-flex"
        >
          <Trash2 size={15} aria-hidden="true" />
        </Btn>
      )}

      {showAdd && (
        <form onSubmit={add} className="flex items-center gap-1.5">
          <Field
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={copy.profile.namePlaceholder}
            aria-label={copy.profile.nameLabel}
            className="w-28"
          />
          <Btn type="submit" size="sm">{copy.profile.addShort}</Btn>
        </form>
      )}

      {error && (
        <p role="alert" className="w-full text-xs font-bold text-rasp-ink">{error}</p>
      )}
    </div>
  );
}