import { useCallback, useEffect, useState } from "react";
import { copy } from "../copy";
import { boundedFetch } from "../lib/api";
import { Btn, Notice } from "../ui/primitives";

interface SessionRecord {
  id: string;
  deviceLabel: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

function dateLabel(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

export function SessionSettings({ offline = false }: { offline?: boolean }) {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await boundedFetch("/api/auth/sessions");
      if (!response.ok) throw new Error("sessions unavailable");
      setSessions(((await response.json()) as { sessions: SessionRecord[] }).sessions);
      setMessage("");
    } catch {
      setMessage(copy.security.sessionsFailed);
    }
  }, []);

  useEffect(() => {
    if (!offline) void refresh();
  }, [offline, refresh]);

  const revoke = async (id: string) => {
    setBusyId(id);
    setMessage("");
    try {
      const response = await boundedFetch(`/api/auth/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("session revoke failed");
      setSessions((current) => current.filter((session) => session.id !== id));
      setMessage(copy.security.sessionRevoked);
    } catch {
      setMessage(copy.security.sessionsFailed);
    } finally {
      setBusyId(null);
    }
  };

  if (offline) return null;
  return (
    <section className="mt-6 border-t-2 border-dashed border-ink/20 pt-5" aria-labelledby="sessions-heading">
      <h2 id="sessions-heading" className="font-display text-xl font-semibold text-ink">{copy.security.sessionsHeading}</h2>
      <p className="mt-1 text-sm text-ink2">{copy.security.sessionsIntro}</p>
      {sessions.map((session) => (
        <div key={session.id} className="mt-3 flex items-center justify-between gap-3 rounded-xl border-2 border-ink/20 p-3">
          <div className="min-w-0">
            <p className="truncate font-semibold text-ink">{session.deviceLabel || (session.current ? copy.security.thisDevice : copy.security.otherDevice)}</p>
            <p className="text-xs text-ink3">{copy.security.lastActive(dateLabel(session.lastUsedAt))}</p>
          </div>
          {!session.current && (
            <Btn size="sm" variant="quiet" disabled={busyId !== null} onClick={() => void revoke(session.id)}>
              {copy.security.signOutDevice}
            </Btn>
          )}
        </div>
      ))}
      {message && <Notice className="mt-3" role="status">{message}</Notice>}
    </section>
  );
}
