import { X, Clock3, FileAudio, Sparkles } from "lucide-react";
import { useState } from "react";
import type { Audiobook } from "../types";
import { ChapterPlayer } from "./ChapterPlayer";

function durationLabel(seconds: number) {
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

interface Candidate {
  id: number;
  source: string;
  title: string;
  author?: string;
  coverUrl?: string;
  description?: string;
  confidence?: number;
}

function MetadataEditor({ book, onUpdated }: { book: Audiobook; onUpdated: () => void }) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");

  const enrich = async () => {
    setState("loading");
    try {
      const res = await fetch(`/api/audiobooks/${book.id}/enrich`, { method: "POST" });
      if (!res.ok) throw new Error();
      const list = await res.json();
      const rows: Candidate[] = list.map((candidate: { source: string; title: string; author?: string; coverUrl?: string; description?: string; confidence?: number }, index: number) => ({ id: index, ...candidate }));
      // Re-fetch stored candidates so we have real ids
      const stored = await fetch(`/api/audiobooks/${book.id}/candidates`);
      setCandidates(stored.ok ? await stored.json() : rows);
      setState("ready");
    } catch {
      setState("error");
    }
  };

  const apply = async (candidateId: number) => {
    const res = await fetch(`/api/audiobooks/${book.id}/metadata`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateId }),
    });
    if (res.ok) onUpdated();
  };

  return (
    <div className="mt-6 border-t border-slate-800 pt-4">
      <button type="button" onClick={() => void enrich()} className="flex items-center gap-2 text-sm text-cyan-400 hover:text-cyan-300">
        <Sparkles size={16} /> {state === "loading" ? "Looking up…" : "Find metadata online"}
      </button>
      {state === "error" && <p className="mt-2 text-sm text-rose-300">Metadata lookup failed. Try again later.</p>}
      {state === "ready" && (
        <ul className="mt-3 space-y-2">
          {candidates.length === 0 && <li className="text-sm text-slate-500">No matches found.</li>}
          {candidates.map((candidate) => (
            <li key={candidate.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-slate-300">
                {candidate.title} {candidate.author && <span className="text-slate-500">— {candidate.author}</span>}
                <span className="ml-2 text-xs uppercase text-slate-600">{candidate.source}</span>
              </span>
              <button type="button" onClick={() => void apply(candidate.id)} className="shrink-0 border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:border-cyan-400">Use</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AudiobookDetail({ book, onClose }: { book: Audiobook; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm" onClick={onClose}>
      <article className="relative grid max-h-[90vh] w-full max-w-3xl overflow-auto rounded-xl border border-slate-700 bg-slate-900 shadow-2xl md:grid-cols-[220px_1fr]" onClick={(event) => event.stopPropagation()}>
        <button aria-label="Close details" onClick={onClose} className="absolute right-3 top-3 rounded-full bg-slate-950/80 p-2 text-slate-300 hover:text-white"><X size={20} /></button>
        <img src={`/api/audiobooks/${book.id}/cover`} onError={(event) => { event.currentTarget.src = "/placeholder-cover.svg"; }} alt="" className="aspect-[2/3] w-full object-cover md:h-full" />
        <div className="p-6 md:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-400">Audiobook</p>
          <h2 className="mt-3 text-3xl font-bold text-white">{book.title}</h2>
          <p className="mt-2 text-lg text-slate-300">{book.author}</p>
          {book.narrator && <p className="mt-1 text-sm text-slate-400">Narrated by {book.narrator}</p>}
          <div className="mt-6 flex flex-wrap gap-3 text-sm text-slate-300">
            <span className="flex items-center gap-2"><Clock3 size={16} /> {durationLabel(book.duration)}</span>
            <span className="flex items-center gap-2"><FileAudio size={16} /> {book.fileFormat.toUpperCase()}</span>
          </div>
          {book.description && <p className="mt-6 leading-7 text-slate-400">{book.description}</p>}
          <MetadataEditor book={book} onUpdated={() => window.location.reload()} />
          <ChapterPlayer key={book.id} book={book} />
        </div>
      </article>
    </div>
  );
}
