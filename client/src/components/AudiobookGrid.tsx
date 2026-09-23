import { Clock3, Headphones } from "lucide-react";
import type { Audiobook } from "../types";

function durationLabel(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function AudiobookGrid({ books, onSelect }: { books: Audiobook[]; onSelect: (book: Audiobook) => void }) {
  if (!books.length) {
    return <div className="border border-dashed border-slate-700 bg-slate-900/60 px-6 py-16 text-center text-slate-400">Your library is empty. Add a folder and run a scan to discover audiobooks.</div>;
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {books.map((book) => (
        <button key={book.id} onClick={() => onSelect(book)} className="group overflow-hidden rounded-lg border border-slate-800 bg-slate-900 text-left transition hover:-translate-y-1 hover:border-cyan-500/60 hover:bg-slate-800">
          <div className="relative aspect-[2/3] overflow-hidden bg-slate-800">
            <img src={`/api/audiobooks/${book.id}/cover`} onError={(event) => { event.currentTarget.src = "/placeholder-cover.svg"; }} alt="" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
            <span className="absolute bottom-2 left-2 flex items-center gap-1 bg-slate-950/80 px-2 py-1 text-xs text-slate-200"><Clock3 size={12} /> {durationLabel(book.duration)}</span>
          </div>
          <div className="p-3">
            <h3 className="truncate font-semibold text-slate-100">{book.title}</h3>
            <p className="mt-1 truncate text-sm text-slate-400">{book.author}</p>
            {book.tracks.length > 1 && <p className="mt-2 flex items-center gap-1 text-xs uppercase tracking-wider text-cyan-400"><Headphones size={12} /> {book.tracks.length} tracks</p>}
          </div>
        </button>
      ))}
    </div>
  );
}