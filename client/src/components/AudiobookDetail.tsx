import { X, Clock3, FileAudio } from "lucide-react";
import type { Audiobook } from "../types";
import { ChapterPlayer } from "./ChapterPlayer";

function durationLabel(seconds: number) {
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
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
          <ChapterPlayer key={book.id} book={book} />
        </div>
      </article>
    </div>
  );
}
